import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { locatePack } from "../../evidence/pack.js";
import { discoverFlows, type Flow } from "../../flows/discover.js";
import { describeFlowProblems, flowProblems, sharedClaims } from "../../flows/validate.js";
import { eventType, num, str, type KaneEvent } from "../../kane/ndjson.js";
import { judgePack } from "../../kane/policy.js";
import { DEFAULT_RUN_CONFIG, runKane, type KaneOutcome, type KaneRunConfig } from "../../kane/runner.js";
import { displayPath, readJsonFile, toPosix, writeJsonAtomic } from "../../shared/fs.js";
import { configureLogger, out } from "../../shared/logger.js";
import { collectFlowResults } from "../../judge/collect.js";
import { emptyResults, isKaneResults, mergeRun, type FlowResult, type KaneResults, type RunRecord } from "../../judge/results.js";
import { formatRunProblem, formatRunSummary } from "../../judge/summary.js";
import { RUN_MARKER } from "../../judge/pending.js";
import { projectPaths, type ProjectPaths } from "../../judge/workspace.js";

export interface RunArgs {
  dir: string;
  only: string[];
  config: Partial<KaneRunConfig>;
  /** Exit 1 unless every flow passed and Kane's verdict on the pack is a pass (for pre-push hooks and CI). */
  gate?: boolean;
  /** Let Kane self-heal in a gate run. Off by default there: a gate pass is the recorded test, replayed as recorded. */
  heal?: boolean;
}

type Gated = Pick<FlowResult, "name" | "status" | "steps" | "asserts">;

/**
 * Why the gate fails, or nothing when it holds. It holds only when every flow
 * passed, really ran steps, ran at least one assert, and Kane's own verdict on
 * the sealed pack is a pass. A missing verdict is a failure, never a pass.
 */
export function gateProblems(run: RunRecord, results: Gated[]): string[] {
  const problems: string[] = [];
  if (run.outcome !== "passed") problems.push(`Kane's run ${run.outcome}`);
  if (results.length === 0) problems.push("Kane reported no flows");
  for (const name of run.flows) if (!results.some(f => f.name === name)) problems.push(`Kane reported no completed result for ${name}`);
  for (const flow of results) {
    if (flow.status !== "passed") problems.push(`${flow.name} ${flow.status}`);
    else if (flow.steps.length === 0) problems.push(`${flow.name} ran no steps`);
    else if ((flow.asserts?.passed ?? 0) < 1) problems.push(`${flow.name} passed without a single assert step in Kane's evidence`);
  }
  if (!run.kaneVerdict) problems.push("Kane's verdict on the evidence pack is missing");
  else if (run.kaneVerdict.result !== "pass") problems.push(`Kane's verdict on the evidence pack is ${run.kaneVerdict.result}`);
  else if (run.kaneVerdict.policy !== "kane-judge-claims" || !["no-failed-flows", "no-unjudged-flows", "no-skipped-flows", "every-passed-flow-has-checks"].every(id => run.kaneVerdict?.gates.some(g => g.id === id && g.status === "pass"))) problems.push("Kane's verdict does not pass every required claims gate");
  return problems;
}

function progress(event: KaneEvent): void {
  const type = eventType(event) ?? "";
  const name = (str(event, "path") ?? "").split(/[\\/]/).pop()?.replace(/_test\.md$/, "");
  if (type.endsWith("member_start")) {
    process.stderr.write(`  ▶ ${name}${type.includes("authored") ? " (first run: Kane is authoring it)" : ""}\n`);
  } else if (type.endsWith("member_end")) {
    const secs = num(event, "duration_s");
    process.stderr.write(`  ${str(event, "status") === "passed" ? "✓" : "✗"} ${name}${secs !== undefined ? ` (${Math.round(secs)}s)` : ""}\n`);
  }
}

async function loadResults(paths: ProjectPaths): Promise<KaneResults> {
  let raw: unknown;
  try { raw = await readJsonFile(paths.results); }
  catch { throw new Error("kane-results.json is not readable JSON. Restore it before running again; run history must not be silently reset."); }
  if (raw === undefined) return emptyResults();
  if (!isKaneResults(raw)) throw new Error("kane-results.json has an invalid shape. Restore it before running again; run history must not be silently reset.");
  return raw;
}

function selectFlows(all: Flow[], only: string[]): { flows: Flow[]; missing: string[] } {
  if (only.length === 0) return { flows: all, missing: [] };
  const flows = all.filter((f) => only.includes(f.name));
  return { flows, missing: only.filter((name) => !all.some((f) => f.name === name)) };
}

/** Flows Kane could not really run (no start URL, no steps, no checks), with what is wrong in each. */
async function invalidFlows(flows: Flow[], paths: ProjectPaths): Promise<Array<{ file: string; problems: string[] }>> {
  const invalid: Array<{ file: string; problems: string[] }> = [];
  for (const flow of flows) {
    const text = await readFile(join(paths.dir, flow.file), "utf8");
    const problems = flowProblems(flow, text);
    if (problems.length) invalid.push({ file: flow.file, problems });
  }
  return invalid;
}

/** sha256 of a file, or undefined when it can't be read. */
export async function fileSha256(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return undefined;
  }
}

/** Runs `work` with a marker in the project, so the Stop hook knows Kane is still running there. */
async function whileMarked<T>(paths: ProjectPaths, work: () => Promise<T>): Promise<T> {
  const marker = join(paths.dir, RUN_MARKER);
  await mkdir(join(paths.dir, ".kane-judge"), { recursive: true });
  try {
    await writeFile(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another run owns ${marker}. Wait for it to finish. If it was killed, remove this marker only after confirming no run is active.`);
    throw err;
  }
  try {
    return await work();
  } finally {
    await rm(marker, { force: true });
  }
}

function record(outcome: KaneOutcome, flows: Flow[], paths: ProjectPaths, evidencePath?: string, startUrl?: string): RunRecord {
  const base = { at: new Date().toISOString(), flows: flows.map((f) => f.name), durationS: Math.round(outcome.durationMs / 1000), ...(startUrl ? { startUrl } : {}) };
  if (outcome.kind === "error" || outcome.kind === "timeout") {
    return { ...base, outcome: outcome.kind, reason: outcome.reason, detail: outcome.kind === "error" ? outcome.detail : undefined };
  }
  return { ...base, outcome: outcome.kind, evidencePath: evidencePath ? toPosix(relative(paths.dir, evidencePath)) : undefined };
}

/** `kane-judge run <project>`: run the project's flows with Kane, keep the evidence, print what Kane found. */
export async function runFlowsCommand(args: RunArgs): Promise<number> {
  const paths = projectPaths(args.dir);
  configureLogger({ file: join(paths.dir, ".kane-judge.log"), stderr: false });
  const all = await discoverFlows(paths.dir, "flows");
  const names = all.map(f => basename(f.file));
  if (new Set(names).size !== names.length) {
    out("Flow file names must be unique, including across subfolders: Kane identifies members by file name. Rename the duplicate *_test.md files before running.");
    return 2;
  }
  const { flows, missing } = selectFlows(all, args.only);
  if (missing.length) {
    out(`No flow named ${missing.join(", ")} in ${paths.flowsDir}. Nothing was run.`);
    return 2;
  }
  if (args.gate && flows.length !== all.length) {
    out("A gate must run every active flow. Remove --only; use a normal run to investigate one flow.");
    return 2;
  }
  if (flows.length === 0) {
    out(`No flows to run. Write one *_test.md per claim in ${paths.flowsDir}.`);
    return 2;
  }
  const shared = sharedClaims(all);
  if (shared.length) {
    out(`Not run: one Kane flow tests one claim. ${shared.map((s) => `Claim ${s.claim} has ${s.files.length} flows (${s.files.join(", ")})`).join(". ")}. Fold them into one file per claim.`);
    return 2;
  }
  const invalid = await invalidFlows(flows, paths);
  if (invalid.length) {
    out(describeFlowProblems(invalid));
    return 2;
  }
  const config = { ...DEFAULT_RUN_CONFIG, ...(args.gate ? { parallel: 1 } : {}), ...args.config, ...(args.gate && !args.heal ? { adaptiveHeal: false } : {}) };
  return whileMarked(paths, async () => {
    const prev = await loadResults(paths);
    process.stderr.write(`Kane Judge: running ${flows.length} flow(s) in real Chrome${config.startUrl ? ` against ${config.startUrl}` : ""}: ${flows.map((f) => f.name).join(", ")}\n`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const rawLogPrefix = join(paths.dir, ".kane-judge", `run-${stamp}`);
    const outcome = await runKane({ projectDir: paths.dir, config, flows, label: `kane-judge-${flows[0]?.name ?? "run"}`, onEvent: progress, rawLogPrefix });
    const startedMs = Date.now() - outcome.durationMs;
    if (outcome.kind === "error" || outcome.kind === "timeout") {
      const run = record(outcome, flows, paths, undefined, config.startUrl);
      await writeJsonAtomic(paths.results, mergeRun(prev, run, []));
      out(formatRunProblem(run));
      return 2;
    }
    const evidencePath = outcome.evidencePath ?? (await locatePack(paths.dir, { executionId: outcome.summary.executionId, sinceMs: startedMs - 5_000 }));
    const ran = { ...outcome, evidencePath };
    const kaneVerdict = evidencePath ? await judgePack({ kaneBin: config.kaneBin, projectDir: paths.dir, packPath: evidencePath }) : undefined;
    const run: RunRecord = { ...record(ran, flows, paths, evidencePath, config.startUrl), ...(config.adaptiveHeal === false ? { heal: false } : {}), kaneVerdict, packSha256: evidencePath ? await fileSha256(evidencePath) : undefined };
    const earlierRuns = Object.fromEntries(Object.values(prev.flows).map((f) => [f.name, f.attempts]));
    const results = await collectFlowResults(ran, flows, paths, run.at, earlierRuns, config.startUrl);
    await writeJsonAtomic(paths.results, mergeRun(prev, run, results));
    out(formatRunSummary(run, results, displayPath(paths.dir)));
    if (!args.gate) return 0;
    const problems = gateProblems(run, results);
    const healed = config.adaptiveHeal === false ? " Self-healing was off: every flow replayed as recorded." : "";
    const hint = config.adaptiveHeal === false ? " If a flow only missed a recorded step, run it once without --gate so Kane can re-author it, then run the gate again." : "";
    out(problems.length === 0 ? `Gate: PASS. Kane proved every flow.${healed}` : `Gate: FAIL. Kane has not signed off (exit 1): ${problems.join("; ")}.${hint}`);
    return problems.length === 0 ? 0 : 1;
  });
}
