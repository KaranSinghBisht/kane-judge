import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { checkShareableDefinition, leaksIn, scrubText, sharePack } from "../../evidence/share-pack.js";
import { isKaneResults, type KaneResults, type RunRecord } from "../../judge/results.js";
import { CLAIMS_POLICY } from "../../kane/policy.js";
import { projectPaths, type ProjectPaths } from "../../judge/workspace.js";
import { discoverFlows } from "../../flows/discover.js";
import { displayPath, readJsonFile, relativeInside, writeJsonAtomic } from "../../shared/fs.js";
import { out } from "../../shared/logger.js";
import { reportCommand } from "./report.js";
import { isLocalDir, readLocalReadme } from "../../scan/local.js";

export interface ShareArgs {
  dir: string;
  /** Where the copy goes. Default: `<project>-share` beside the project. */
  out?: string;
}

/** Folder of the share copy that holds the evidence packs. Visible, so nothing hides it from git. */
const PACKS_DIR = "packs";
/** The policy Kane's verdict engine judged the packs against, shipped with the copy so anyone can re-run it. */
const POLICY_FILE = "kane-judge-claims.policy.yaml";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface Scrub {
  /** Local folders, replaced by a short label, longest first. */
  roots: Array<[string, string]>;
  /** Account and machine values, replaced by "redacted". */
  secrets: string[];
}

function clean(text: string, scrub: Scrub): string {
  let cleaned = text;
  for (const [root, label] of [...scrub.roots].sort((a, b) => b[0].length - a[0].length)) cleaned = cleaned.split(root).join(label);
  return scrubText(cleaned, scrub.secrets);
}

/** The machine's own identity: nothing in a share copy may name the user's home folder or account. */
function machineSecrets(): string[] {
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return "";
    }
  })();
  return [homedir(), user].filter((value) => value !== "");
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  return readdir(dir).then(
    (names) => names.length === 0,
    () => true,
  );
}

/** Writes the share copy of every pack that is on disk, and returns the run records that point at the copies. */
async function sharePacks(paths: ProjectPaths, outDir: string, results: KaneResults, scrub: Scrub): Promise<{ runs: RunRecord[]; shared: number; problems: string[] }> {
  const runs: RunRecord[] = [];
  const problems: string[] = [];
  let shared = 0;
  for (const run of results.runs) {
    const rel = run.evidencePath ? relativeInside(paths.dir, run.evidencePath) : undefined;
    const sealed = rel ? await readFile(resolve(paths.dir, rel)).catch(() => undefined) : undefined;
    if (!rel || !sealed) {
      runs.push(run);
      continue;
    }
    if (run.packSha256 && sha256(sealed) !== run.packSha256 && sha256(sealed) !== run.sharedPackSha256) {
      problems.push(`the evidence pack of the run at ${run.at} is not the file Kane sealed (its hash changed)`);
      continue;
    }
    const copy = sharePack(new Uint8Array(sealed), [...scrub.secrets, ...scrub.roots.map(([root]) => root)]);
    scrub.secrets.push(...copy.identity);
    const leaks = leaksIn(copy.bytes, scrub.secrets);
    if (leaks.length) {
      problems.push(`could not remove the account from ${basename(rel)} (${leaks.slice(0, 3).join(", ")})`);
      continue;
    }
    const name = `${PACKS_DIR}/${basename(rel)}`;
    await mkdir(join(outDir, PACKS_DIR), { recursive: true });
    await writeFile(join(outDir, name), copy.bytes);
    runs.push({ ...run, evidencePath: name, packSha256: run.packSha256 ?? sha256(sealed), sharedPackSha256: sha256(copy.bytes) });
    shared += 1;
  }
  return { runs, shared, problems };
}

/** Every image the results point at: final screenshots and the step frames of each replay. */
function referencedImages(results: KaneResults): string[] {
  const files = new Set<string>();
  for (const flow of Object.values(results.flows)) {
    for (const run of [flow, ...(flow.history ?? [])]) {
      if (run.screenshot) files.add(run.screenshot);
      for (const frame of run.frames ?? []) files.add(frame.file);
    }
  }
  return [...files];
}

async function copyText(from: string, to: string, scrub: Scrub): Promise<void> {
  const text = await readFile(from, "utf8").catch(() => undefined);
  if (text === undefined) return;
  if (from.endsWith("_test.md")) checkShareableDefinition(text);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, clean(text, scrub), "utf8");
}

async function copyFolderText(paths: ProjectPaths, outDir: string, folder: string, scrub: Scrub): Promise<void> {
  for (const flow of await discoverFlows(paths.dir, folder)) {
    await copyText(join(paths.dir, flow.file), join(outDir, flow.file), scrub);
  }
  // Keep top-level Markdown notes that accompany the flow files.
  const entries = await readdir(join(paths.dir, folder), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter(e => e.isFile() && e.name.endsWith(".md") && !e.name.endsWith("_test.md"))) {
    await copyText(join(paths.dir, folder, entry.name), join(outDir, folder, entry.name), scrub);
  }
}

/** Local folders a project's files may name: the project, its workspace, and a builder's own checkout. Each gets a short label. */
async function localRoots(paths: ProjectPaths): Promise<Array<[string, string]>> {
  const roots: Array<[string, string]> = [[paths.dir, "."]];
  const parent = dirname(paths.dir);
  roots.push([parent, "."]);
  if (basename(parent) === "projects") roots.push([dirname(parent), "."]);
  const scan = (await readJsonFile(paths.scan).catch(() => undefined)) as { repos?: Array<{ url?: string }> } | undefined;
  for (const repo of scan?.repos ?? []) {
    if (repo.url && !/^https?:\/\//i.test(repo.url) && repo.url.startsWith("/")) roots.push([repo.url, basename(repo.url)]);
  }
  return roots;
}

/** scan.json for the copy: a local folder is named, not located. */
async function copyScan(paths: ProjectPaths, outDir: string, scrub: Scrub): Promise<void> {
  const scan = (await readJsonFile(paths.scan).catch(() => undefined)) as { repos?: Array<{ url?: string }>; inputs?: string[] } | undefined;
  if (!scan) return;
  const local = (value: string) => !/^https?:\/\//i.test(value);
  for (const repo of scan.repos ?? []) if (repo.url && local(repo.url)) repo.url = basename(repo.url);
  scan.inputs = (scan.inputs ?? []).map((input) => (local(input) ? basename(resolve(input)) : input));
  await writeFile(join(outDir, "scan.json"), clean(`${JSON.stringify(scan, null, 2)}\n`, scrub), "utf8");
}

async function copyProject(paths: ProjectPaths, outDir: string, results: KaneResults, scrub: Scrub): Promise<void> {
  await copyFolderText(paths, outDir, "flows", scrub);
  await copyFolderText(paths, outDir, "withdrawn", scrub);
  await copyText(paths.submission, join(outDir, "submission.md"), scrub);
  await copyText(paths.verdict, join(outDir, "verdict.json"), scrub);
  await copyScan(paths, outDir, scrub);
  const scan = (await readJsonFile(paths.scan)) as { mode?: string; repos?: Array<{ url?: string }> } | undefined;
  if (scan?.mode === "preflight") {
    const folder = scan.repos?.map(r => r.url).find((url): url is string => !!url && isAbsolute(url) && isLocalDir(url));
    const current = folder ? await readLocalReadme(folder) : await readFile(join(paths.dir, "README.after.md"), "utf8").catch(() => undefined);
    if (current !== undefined) await writeFile(join(outDir, "README.after.md"), clean(current, scrub), "utf8");
  }
  for (const image of referencedImages(results)) {
    const rel = relativeInside(paths.dir, image);
    if (!rel) continue;
    await mkdir(dirname(join(outDir, rel)), { recursive: true });
    await copyFile(resolve(paths.dir, rel), join(outDir, rel)).catch(() => undefined);
  }
}

/**
 * `kane-judge share <project>`: a copy of a judged project that is safe to
 * commit or send. It holds the flows, Kane's results, the verdict, the
 * scorecard and Kane's evidence packs, with the Kane account and this
 * machine's paths removed. The copy is then checked like any other project,
 * so what you share is a scorecard that still stands on its evidence.
 */
export async function shareCommand(args: ShareArgs): Promise<number> {
  const paths = projectPaths(args.dir);
  const outDir = resolve(args.out ?? `${paths.dir}-share`);
  const results = await readJsonFile(paths.results).catch(() => undefined);
  if (!isKaneResults(results)) {
    out(`kane-judge share: no Kane results in ${displayPath(paths.dir)} yet. Run the flows and the report first.`);
    return 2;
  }
  if (!(await isEmptyOrMissing(outDir))) {
    out(`kane-judge share: ${displayPath(outDir)} already has files in it. Remove it, or pick another folder with --out.`);
    return 2;
  }
  await mkdir(outDir, { recursive: true });
  const scrub: Scrub = { roots: await localRoots(paths), secrets: machineSecrets() };
  const staging = await mkdtemp(join(dirname(outDir), ".kane-share-"));
  let shared = 0;
  let runs: RunRecord[] = [];
  try {
    const packs = await sharePacks(paths, staging, results, scrub);
    if (packs.problems.length) {
      out(`kane-judge share: stopped before publishing the copy.\n${packs.problems.join("\n")}`);
      return 2;
    }
    await copyProject(paths, staging, results, scrub);
    await writeFile(join(staging, POLICY_FILE), CLAIMS_POLICY, "utf8");
    await writeJsonAtomic(join(staging, "kane-results.json"), JSON.parse(clean(JSON.stringify({ ...results, runs: packs.runs }), scrub)) as unknown);
    await rename(staging, outDir);
    shared = packs.shared;
    runs = packs.runs;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  out(`Share copy: ${displayPath(outDir)} (${shared} evidence pack(s), Kane account and local paths removed)`);
  const code = await reportCommand(outDir);
  if (code === 0 && shared > 0) {
    const pack = [...runs].reverse().find((r) => r.sharedPackSha256)?.evidencePath ?? PACKS_DIR;
    out(`Anyone can have Kane's own verdict engine re-judge it, without an account or credits:\n  cd ${displayPath(outDir)} && kane-cli evidence verdict ${pack} --policy ${POLICY_FILE}`);
  }
  return code;
}
