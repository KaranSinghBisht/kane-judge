import { join, relative } from "node:path";
import { locatePack } from "../../evidence/pack.js";
import { discoverFlows, type Flow } from "../../flows/discover.js";
import { eventType, num, str, type KaneEvent } from "../../kane/ndjson.js";
import { DEFAULT_RUN_CONFIG, runKane, type KaneOutcome, type KaneRunConfig } from "../../kane/runner.js";
import { readJsonFile, toPosix, writeJsonAtomic } from "../../shared/fs.js";
import { configureLogger, out } from "../../shared/logger.js";
import { collectFlowResults } from "../../judge/collect.js";
import { emptyResults, isKaneResults, mergeRun, type KaneResults, type RunRecord } from "../../judge/results.js";
import { formatRunProblem, formatRunSummary } from "../../judge/summary.js";
import { projectPaths, type ProjectPaths } from "../../judge/workspace.js";

export interface RunArgs {
  dir: string;
  only: string[];
  config: Partial<KaneRunConfig>;
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
  const raw = await readJsonFile(paths.results).catch(() => undefined);
  return isKaneResults(raw) ? raw : emptyResults();
}

function selectFlows(all: Flow[], only: string[]): { flows: Flow[]; missing: string[] } {
  if (only.length === 0) return { flows: all, missing: [] };
  const flows = all.filter((f) => only.includes(f.name));
  return { flows, missing: only.filter((name) => !all.some((f) => f.name === name)) };
}

function record(outcome: KaneOutcome, flows: Flow[], paths: ProjectPaths, evidencePath?: string): RunRecord {
  const base = { at: new Date().toISOString(), flows: flows.map((f) => f.name), durationS: Math.round(outcome.durationMs / 1000) };
  if (outcome.kind === "error" || outcome.kind === "timeout") {
    return { ...base, outcome: outcome.kind, reason: outcome.reason, detail: outcome.kind === "error" ? outcome.detail : undefined };
  }
  return { ...base, outcome: outcome.kind, evidencePath: evidencePath ? toPosix(relative(paths.dir, evidencePath)) : undefined };
}

/** `kane-judge run <project>`: run the project's flows with Kane, keep the evidence, print what Kane found. */
export async function runFlowsCommand(args: RunArgs): Promise<number> {
  const paths = projectPaths(args.dir);
  configureLogger({ file: join(paths.dir, ".kane-judge.log"), stderr: false });
  const { flows, missing } = selectFlows(await discoverFlows(paths.dir, "flows"), args.only);
  if (missing.length) out(`No flow named ${missing.join(", ")} in ${paths.flowsDir}.`);
  if (flows.length === 0) {
    out(`No flows to run. Write one *_test.md per claim in ${paths.flowsDir}.`);
    return 2;
  }
  const noUrl = flows.filter((f) => !f.url).map((f) => f.name);
  if (noUrl.length) out(`Warning: no \`url:\` frontmatter in ${noUrl.join(", ")}; Kane needs a start URL.`);
  process.stderr.write(`Kane Judge: running ${flows.length} flow(s) in real Chrome: ${flows.map((f) => f.name).join(", ")}\n`);
  const config = { ...DEFAULT_RUN_CONFIG, ...args.config };
  const outcome = await runKane({ projectDir: paths.dir, config, flows, label: `kane-judge-${flows[0]?.name ?? "run"}`, onEvent: progress });
  const startedMs = Date.now() - outcome.durationMs;
  const prev = await loadResults(paths);
  if (outcome.kind === "error" || outcome.kind === "timeout") {
    const run = record(outcome, flows, paths);
    await writeJsonAtomic(paths.results, mergeRun(prev, run, []));
    out(formatRunProblem(run));
    return 2;
  }
  const evidencePath = outcome.evidencePath ?? (await locatePack(paths.dir, { executionId: outcome.summary.executionId, sinceMs: startedMs - 5_000 }));
  const ran = { ...outcome, evidencePath };
  const run = record(ran, flows, paths, evidencePath);
  const results = await collectFlowResults(ran, flows, paths, run.at);
  await writeJsonAtomic(paths.results, mergeRun(prev, run, results));
  out(formatRunSummary(run, results, toPosix(relative(process.cwd(), paths.dir)) || paths.dir));
  return 0;
}
