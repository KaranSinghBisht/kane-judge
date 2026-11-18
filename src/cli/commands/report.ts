import { readdir } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { isLocalDir, readLocalReadme } from "../../scan/local.js";
import type { ScanResult } from "../../scan/types.js";
import { readJsonFile, writeTextAtomic } from "../../shared/fs.js";
import { out } from "../../shared/logger.js";
import { boardRows, renderBoardHtml, renderBoardMarkdown, type BoardEntry } from "../../judge/board.js";
import { checkAgainstKane, checkCoverage, checkMode, checkScoreEvidence, checkWithdrawn } from "../../judge/evidence-check.js";
import { imageDataUri } from "../../judge/html.js";
import { renderReportMarkdown } from "../../judge/report-md.js";
import { verifyPacks, type PackCheck } from "../../judge/pack-verify.js";
import { isKaneResults, type KaneResults } from "../../judge/results.js";
import { claimReplays, claimShots, headline, overall, renderScorecard } from "../../judge/scorecard.js";
import type { Verdict } from "../../judge/verdict.js";
import { checkVerdict } from "../../judge/verdict-check.js";
import { PROJECTS_DIR, projectPaths, type ProjectPaths } from "../../judge/workspace.js";

export type Loaded = { ok: true; verdict: Verdict; results?: KaneResults; scan?: ScanResult; packs: PackCheck } | { ok: false; errors: string[] };

/** The builder's README as it is now, for a pre-flight: a withdrawn claim must be gone from it. */
async function builderReadme(scan: ScanResult | undefined): Promise<string | undefined> {
  // A local scan records the folder's full path as the repo's URL; `inputs` may hold a relative one.
  const folder = scan?.mode === "preflight" ? scan.repos.map((r) => r.url).find((url) => !/^https?:\/\//i.test(url) && isLocalDir(url)) : undefined;
  return folder ? readLocalReadme(folder) : undefined;
}

async function readOptional(path: string, what: string, valid: (v: unknown) => boolean): Promise<unknown> {
  let raw: unknown;
  try {
    raw = await readJsonFile(path);
  } catch {
    out(`warning: ${what} is not valid JSON; the scorecard is built without it`);
    return undefined;
  }
  if (raw === undefined) return undefined;
  if (!valid(raw)) {
    out(`warning: ${what} has an unexpected shape; the scorecard is built without it`);
    return undefined;
  }
  return raw;
}

/** Reads a project's verdict and holds it to Kane's record. Every evidence rule runs here; nothing is written. */
export async function checkProject(paths: ProjectPaths): Promise<Loaded> {
  let raw: unknown;
  try {
    raw = await readJsonFile(paths.verdict);
  } catch (err) {
    return { ok: false, errors: [`verdict.json is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`] };
  }
  if (raw === undefined) return { ok: false, errors: [`no verdict.json in ${paths.dir} yet`] };
  const checked = checkVerdict(raw);
  if (!checked.ok) return checked;
  const results = (await readOptional(paths.results, "kane-results.json", isKaneResults)) as KaneResults | undefined;
  const scan = (await readOptional(paths.scan, "scan.json", (v) => (v as ScanResult)?.version === 1)) as ScanResult | undefined;
  const packs = await verifyPacks(paths.dir, results);
  const errors = [
    ...checkMode(checked.verdict, scan),
    ...checkAgainstKane(checked.verdict, results),
    ...checkWithdrawn(checked.verdict, await builderReadme(scan)),
    ...checkCoverage(checked.verdict, scan),
    ...checkScoreEvidence(checked.verdict),
    ...packs.problems,
  ];
  if (errors.length) return { ok: false, errors };
  return { ok: true, verdict: checked.verdict, results, scan, packs };
}

/** Replays are dropped, a whole run at a time, once the page would carry more image data than this. */
const REPLAY_BUDGET_CHARS = 9_000_000;

/** A data URI for a project-relative image, or nothing when it lies outside the project or can't be embedded. */
async function embed(paths: ProjectPaths, file: string): Promise<string | undefined> {
  const abs = resolve(paths.dir, file);
  const rel = relative(paths.dir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return imageDataUri(abs);
}

/** Every image the scorecard embeds: each claim's screenshots, then as many step replays as fit the budget. */
async function images(paths: ProjectPaths, verdict: Verdict, results?: KaneResults): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const shot of verdict.claims.flatMap((claim) => claimShots(claim, results))) {
    const uri = map.has(shot) ? undefined : await embed(paths, shot);
    if (uri) map.set(shot, uri);
  }
  let used = 0;
  for (const replay of verdict.claims.flatMap((claim) => claimReplays(claim, results))) {
    const loaded = await Promise.all(replay.map(async (file) => [file, map.get(file) ?? (await embed(paths, file))] as const));
    const size = loaded.reduce((n, [, uri]) => n + (uri?.length ?? 0), 0);
    if (loaded.some(([, uri]) => !uri) || used + size > REPLAY_BUDGET_CHARS) continue;
    used += size;
    for (const [file, uri] of loaded) if (uri) map.set(file, uri);
  }
  return map;
}

/** `kane-judge report <project>`: validate verdict.json and write scorecard.html + report.md. */
export async function reportCommand(dir: string): Promise<number> {
  const paths = projectPaths(dir);
  const loaded = await checkProject(paths);
  if (!loaded.ok) {
    out(`Can't build the scorecard yet:\n${loaded.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 2;
  }
  const input = { verdict: loaded.verdict, results: loaded.results, scan: loaded.scan, packs: loaded.packs, images: await images(paths, loaded.verdict, loaded.results) };
  await writeTextAtomic(paths.scorecardHtml, renderScorecard(input));
  await writeTextAtomic(paths.reportMd, renderReportMarkdown(input));
  const o = overall(loaded.verdict);
  out(`${loaded.verdict.project.name}: ${headline(loaded.verdict)} · rubric ${o.pct}%\nScorecard: ${paths.scorecardHtml}\nReport:    ${paths.reportMd}`);
  return 0;
}

/** `kane-judge board [workspace]`: rank every judged project. */
export async function boardCommand(workspace: string): Promise<number> {
  const root = join(workspace, PROJECTS_DIR);
  const dirents = await readdir(root, { withFileTypes: true }).catch(() => []);
  const slugs = dirents.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  const entries: BoardEntry[] = [];
  for (const slug of slugs.sort()) {
    const loaded = await checkProject(projectPaths(join(root, slug)));
    if (loaded.ok) entries.push({ verdict: loaded.verdict, results: loaded.results, scan: loaded.scan, dir: slug });
    else out(`skipped ${slug}: ${loaded.errors[0] ?? "no verdict"}`);
  }
  if (entries.length === 0) {
    out(`No judged projects under ${root} yet.`);
    return 2;
  }
  const rows = boardRows(entries);
  await writeTextAtomic(join(workspace, "SCOREBOARD.md"), renderBoardMarkdown(rows));
  await writeTextAtomic(join(workspace, "scoreboard.html"), renderBoardHtml(rows));
  out([...rows.map((r) => `${r.rank}. ${r.name}: ${r.pct}% (${r.proven}/${r.claims} proven, ${r.broken} broken)`), "", `Wrote ${join(workspace, "SCOREBOARD.md")} and scoreboard.html`].join("\n"));
  return 0;
}
