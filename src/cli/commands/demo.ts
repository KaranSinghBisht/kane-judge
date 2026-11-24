import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describePolicyVerdict, judgePack } from "../../kane/policy.js";
import type { KaneResults } from "../../judge/results.js";
import { claimLabel, claimsInReadingOrder, headline } from "../../judge/scorecard.js";
import type { Verdict } from "../../judge/verdict.js";
import { projectPaths, type ProjectPaths } from "../../judge/workspace.js";
import { out } from "../../shared/logger.js";
import { runCommand } from "../../shared/proc.js";
import { checkProject, reportCommand, type Loaded } from "./report.js";

export interface DemoArgs {
  /** Open the scorecard in the browser when done. */
  open: boolean;
  /** The judged project to replay. Default: the run that ships with Kane Judge. */
  example?: string;
  /** False leaves Kane CLI out of it (the checks themselves never need it). */
  kane?: boolean;
}

interface Doctored {
  verdict: Verdict;
  results: KaneResults;
  /** When set, the latest run's evidence pack is replaced by these bytes. */
  pack?: Uint8Array;
}

interface Cheat {
  title: string;
  /** Returns the doctored project, or undefined when this project gives the cheat nothing to work with. */
  apply: (verdict: Verdict, results: KaneResults) => Doctored | undefined;
  /** The refusal to show for this cheat is the one that mentions this. */
  expect: RegExp;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const CHEATS: Cheat[] = [
  {
    title: "Call a broken claim proven",
    expect: /marked proven, but Kane's latest run/,
    apply: (verdict, results) => {
      const broken = verdict.claims.find((c) => c.status === "broken" && c.flow);
      if (!broken) return undefined;
      broken.status = "proven";
      return { verdict, results };
    },
  },
  {
    title: "Back a broken claim with another claim's passing test",
    expect: /already backs claim|as the flow for claim/,
    apply: (verdict, results) => {
      const broken = verdict.claims.find((c) => c.status === "broken");
      const proven = verdict.claims.find((c) => c.status === "proven" && c.flow);
      if (!broken || !proven) return undefined;
      broken.status = "proven";
      broken.flow = proven.flow;
      return { verdict, results };
    },
  },
  {
    title: "Leave the broken claims out of the verdict",
    expect: /can't be left out/,
    apply: (verdict, results) => {
      const kept = verdict.claims.filter((c) => c.status !== "broken");
      if (kept.length === verdict.claims.length || kept.length === 0) return undefined;
      return { verdict: { ...verdict, claims: kept }, results };
    },
  },
  {
    title: 'Declare the verdict a "pre-flight" and withdraw what failed',
    expect: /doesn't match the scan/,
    apply: (verdict, results) => {
      if (verdict.mode === "preflight") return undefined;
      for (const claim of verdict.claims.filter((c) => c.status === "broken")) {
        claim.status = "withdrawn";
        claim.fix = { summary: "No longer claimed.", files: ["README.md"] };
      }
      return { verdict: { ...verdict, mode: "preflight" }, results };
    },
  },
  {
    title: "Edit kane-results.json so a failed test says passed",
    expect: /sealed evidence pack says/,
    apply: (verdict, results) => {
      const failed = Object.values(results.flows).find((f) => f.status !== "passed" && f.history?.length);
      const claim = failed ? verdict.claims.find((c) => c.flow?.includes(failed.name)) : undefined;
      if (!failed || !claim) return undefined;
      failed.status = "passed";
      failed.asserts = { total: 1, passed: 1 };
      for (const entry of failed.history ?? []) entry.status = "passed";
      claim.status = "proven";
      return { verdict, results };
    },
  },
  {
    title: "Swap Kane's evidence pack for another file",
    expect: /not the file Kane sealed/,
    apply: (verdict, results) => (results.runs.some((r) => r.evidencePath) ? { verdict, results, pack: new TextEncoder().encode("not a Kane evidence pack") } : undefined),
  },
  {
    title: "Skip a use-case Kane found in the README",
    expect: /no claim covers it/,
    apply: (verdict, results) => {
      const claim = verdict.claims.find((c) => c.covers?.length);
      if (!claim) return undefined;
      claim.covers = [];
      return { verdict, results };
    },
  },
  {
    title: "Give it 1000 out of 1000",
    expect: /"max" can be at most 10/,
    apply: (verdict, results) => ({ verdict: { ...verdict, scores: [{ criterion: "Everything", score: 1000, max: 1000, why: "Trust me." }] }, results }),
  },
];

/** The judged run that ships with Kane Judge, found from wherever this file runs (the bundle in dist/, or src/ in tests). */
async function bundledExample(): Promise<string | undefined> {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const up of ["..", "../../.."]) {
    const dir = resolve(here, up, "examples", "judged", "inkwell-shop");
    if (await stat(join(dir, "verdict.json")).then(() => true, () => false)) return dir;
  }
  return undefined;
}

function claimLines(verdict: Verdict): string[] {
  return claimsInReadingOrder(verdict).map((claim) => {
    const label = claimLabel(claim);
    const mark = claim.status === "proven" ? "✓" : claim.status === "broken" ? "✗" : "•";
    return `     ${mark} ${claim.id}  ${label.padEnd(12)} ${claim.claim.length > 78 ? `${claim.claim.slice(0, 77)}…` : claim.claim}`;
  });
}

/** Kane's own verdict engine on the latest pack, when Kane CLI is installed. Local: no account, no credits. */
async function kaneLine(paths: ProjectPaths, results: KaneResults): Promise<string> {
  const pack = [...results.runs].reverse().find((r) => r.evidencePath)?.evidencePath;
  if (!pack) return "   This copy holds no evidence pack, so there is nothing for Kane's verdict engine to judge.";
  const probe = await runCommand("kane-cli", ["--version"], { cwd: paths.dir, timeoutMs: 15_000, killGraceMs: 2_000 });
  if (probe.spawnError || probe.exitCode !== 0) {
    return `   Kane CLI isn't installed here. With it, Kane's own verdict engine re-judges the pack, no account or credits needed:\n     npm install -g @testmuai/kane-cli && kane-cli evidence verdict ${join(paths.dir, pack)} --policy policies/claims.yaml`;
  }
  const kane = await judgePack({ kaneBin: "kane-cli", projectDir: paths.dir, packPath: join(paths.dir, pack) });
  return kane
    ? `   Kane's own verdict engine on that pack (kane-cli evidence verdict, 0 credits): ${describePolicyVerdict(kane)}`
    : "   Kane's verdict engine gave no verdict on the pack.";
}

async function restore(paths: ProjectPaths, verdict: Verdict, results: KaneResults, pack: { file: string; bytes: Uint8Array } | undefined): Promise<void> {
  await writeFile(paths.verdict, JSON.stringify(verdict, null, 2), "utf8");
  await writeFile(paths.results, JSON.stringify(results, null, 2), "utf8");
  if (pack) await writeFile(pack.file, pack.bytes);
}

/** Applies each cheat to the copy, runs the same checks `report` runs, and puts the honest files back. */
async function tryCheats(paths: ProjectPaths, verdict: Verdict, results: KaneResults): Promise<{ lines: string[]; tried: number; refused: number }> {
  const packRel = [...results.runs].reverse().find((r) => r.evidencePath)?.evidencePath;
  const packFile = packRel ? join(paths.dir, packRel) : undefined;
  const sealed = packFile ? await readFile(packFile).then((b) => ({ file: packFile, bytes: new Uint8Array(b) }), () => undefined) : undefined;
  const lines: string[] = [];
  let tried = 0;
  let refused = 0;
  for (const cheat of CHEATS) {
    const doctored = cheat.apply(clone(verdict), clone(results));
    if (!doctored || (doctored.pack && !sealed)) continue;
    tried += 1;
    await restore(paths, doctored.verdict, doctored.results, doctored.pack && sealed ? { file: sealed.file, bytes: doctored.pack } : undefined);
    const checked: Loaded = await checkProject(paths);
    await restore(paths, verdict, results, sealed);
    if (checked.ok) {
      lines.push(`   !! ACCEPTED  ${cheat.title}`);
      continue;
    }
    refused += 1;
    const why = checked.errors.find((e) => cheat.expect.test(e)) ?? checked.errors[0] ?? "";
    lines.push(`   ✗ refused   ${cheat.title}`, `               ${why.length > 230 ? `${why.slice(0, 229)}…` : why}`);
  }
  return { lines, tried, refused };
}

function openInBrowser(file: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // No browser to open (a server, CI): the path is printed either way.
  }
}

/**
 * `kane-judge demo`: replay a real judged run on this machine, with no Kane
 * account and no credits. It re-reads Kane's evidence, asks Kane's own verdict
 * engine when Kane CLI is installed, then tries to cheat the scorecard several
 * ways and shows each one refused. Exit 1 if any cheat gets through.
 */
export async function demoCommand(args: DemoArgs): Promise<number> {
  const example = args.example ?? (await bundledExample());
  if (!example) {
    out("kane-judge demo: the example run isn't in this install (examples/judged/inkwell-shop). Clone the repo to try it.");
    return 2;
  }
  if (!(await stat(join(example, "verdict.json")).then(() => true, () => false))) {
    out(`kane-judge demo: ${example} is not a judged project (no verdict.json). Give it a folder made by \`kane-judge share\`.`);
    return 2;
  }
  const dir = join(await mkdtemp(join(tmpdir(), "kane-judge-demo-")), "inkwell-shop");
  await cp(example, dir, { recursive: true });
  const paths = projectPaths(dir);
  const loaded = await checkProject(paths);
  if (!loaded.ok || !loaded.results) {
    out(`kane-judge demo: the example doesn't pass its own checks:\n${loaded.ok ? "  - kane-results.json is missing" : loaded.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 1;
  }
  const { verdict, packs, results } = loaded;
  const flows = Object.keys(results.flows).length;
  out(
    [
      "Kane Judge demo: a real run, re-checked on your machine. No Kane account, no credits.",
      "",
      "1. The recorded run",
      `   ${verdict.project.name}${verdict.project.live ? ` · ${verdict.project.live}` : ""}`,
      `   Kane ran ${flows} flow(s) in real Chrome, ${results.runs.length} run(s), first on ${results.runs[0]?.at.slice(0, 10) ?? "?"}.`,
      `   ${headline(verdict)}`,
      ...claimLines(verdict),
      "",
      "2. Kane's evidence, re-read",
      packs.verified
        ? `   ${packs.verified} evidence pack(s) re-read: each has the hash recorded for it, and every flow's status in the pack matches the results.`
        : "   No evidence pack in this copy: the checks ran against the recorded results only.",
      args.kane === false ? "   (Kane CLI not asked.)" : await kaneLine(paths, results),
      "",
      "3. Now try to cheat the scorecard",
    ].join("\n"),
  );
  const cheats = await tryCheats(paths, verdict, results);
  out([...cheats.lines, `   ${cheats.refused} of ${cheats.tried} refused. Each rule is code (src/judge/evidence-check.ts, pack-verify.ts) with a test (test/integrity.test.ts).`, "", "4. The scorecard"].join("\n"));
  const code = await reportCommand(dir);
  if (code === 0 && args.open) openInBrowser(paths.scorecardHtml);
  return code === 0 && cheats.refused === cheats.tried && cheats.tried > 0 ? 0 : 1;
}
