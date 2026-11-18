import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Flow } from "../flows/discover.js";
import { redact, safeMessage } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { runCommand, type RunResult } from "../shared/proc.js";
import { parseNdjson, parseNdjsonLine, type KaneEvent } from "./ndjson.js";
import { summarizeTestMdStream, type TestMdStep, type TestMdSummary } from "./testmd-stream.js";
import { failedMembers, summarizeTestrunStream, type MemberResult, type TestrunSummary } from "./testrun-stream.js";

/** How Kane CLI is invoked for one batch of flows. */
export interface KaneRunConfig {
  /** kane-cli executable (resolved on PATH, spawned without a shell). */
  kaneBin: string;
  /** Parallel Chrome workers for `kane-cli testrun run`. */
  parallel: number;
  headless: boolean;
  /** Wall-clock limit for the whole Kane run, in seconds. */
  timeoutSec: number;
  /**
   * Run every flow against this URL instead of the one in its `url:` frontmatter
   * (Kane's `--override-start-url`): the same tests against a local build, then the deployed one.
   */
  startUrl?: string;
}

/**
 * Four workers: a project's 3–5 claim flows usually run in one round. Nine
 * minutes, so the run ends by itself inside the 10-minute limit of an agent's
 * foreground shell call instead of being killed half-way.
 */
export const DEFAULT_RUN_CONFIG: KaneRunConfig = { kaneBin: "kane-cli", parallel: 4, headless: true, timeoutSec: 540 };

export interface FlowFailure {
  flow?: Flow;
  member: MemberResult;
  /** The failing `## ` step, from the member's own event log when available. */
  step?: TestMdStep;
  memberLog?: TestMdSummary;
}

interface Timed {
  durationMs: number;
}

/** Each member's own testmd event log, keyed by member path. */
export type MemberLogs = Map<string, TestMdSummary>;

export type KaneOutcome =
  | ({ kind: "passed"; summary: TestrunSummary; evidencePath?: string; memberLogs: MemberLogs } & Timed)
  | ({
      kind: "failed";
      summary: TestrunSummary;
      failures: FlowFailure[];
      evidencePath?: string;
      memberLogs: MemberLogs;
      /** Kane's own error output, when it reported a failure without per-test detail. */
      detail?: string;
    } & Timed)
  | ({ kind: "error"; exitCode: number | null; reason: string; detail?: string } & Timed)
  | ({ kind: "timeout"; reason: string; evidencePath?: string } & Timed);

export interface RunKaneOptions {
  projectDir: string;
  config: KaneRunConfig;
  flows: Flow[];
  /** Short label for the run title in Test Manager ([A-Za-z0-9_-] only). */
  label: string;
  onEvent?: (event: KaneEvent) => void;
  /** When set, Kane's raw stdout (NDJSON) and stderr are saved under this path prefix (+ .ndjson / .stderr.txt). */
  rawLogPrefix?: string;
}

async function saveRaw(prefix: string, result: RunResult): Promise<void> {
  try {
    await mkdir(dirname(prefix), { recursive: true });
    await writeFile(`${prefix}.ndjson`, redact(result.stdout), "utf8");
    await writeFile(`${prefix}.stderr.txt`, redact(result.stderr), "utf8");
  } catch (err) {
    log.warn(`could not save Kane's raw output: ${safeMessage(err)}`);
  }
}

/** argv for `kane-cli testrun run`: one execution, one evidence pack, NDJSON on stdout. */
export function buildTestrunArgs(flows: Flow[], config: KaneRunConfig, label: string): string[] {
  const args = ["testrun", "run", ...flows.map((f) => f.file), "--agent", "--parallel", String(config.parallel)];
  if (config.headless) args.push("--headless");
  if (config.startUrl) args.push("--override-start-url", config.startUrl);
  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);
  if (safeLabel) args.push("--name", safeLabel);
  return args;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Last meaningful stderr lines, without colour codes, update notices or anything that looks like a secret. */
export function stderrTail(stderr: string, maxLines = 12): string {
  const lines = stderr
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !/^[\s│╭╰─╮╯]+$/.test(l) && !/update available/i.test(l));
  return redact(lines.slice(-maxLines).join("\n"));
}

/** Kane prints `evidence: view locally with \`kane-cli evidence serve <path>\`` on stderr after a sealed run. */
export function evidenceHint(stderr: string): string | undefined {
  const match = /evidence serve\s+([^`\n]+?)`/.exec(stderr.replace(ANSI, ""));
  return match?.[1]?.trim();
}

function sameFile(memberPath: string, flowFile: string, projectDir: string): boolean {
  if (resolve(projectDir, memberPath) === resolve(projectDir, flowFile)) return true;
  return basename(memberPath) === basename(flowFile);
}

async function readMemberLog(logPath: string | undefined): Promise<TestMdSummary | undefined> {
  if (!logPath) return undefined;
  try {
    const text = await readFile(logPath, "utf8");
    return summarizeTestMdStream(parseNdjson(text).events);
  } catch (err) {
    log.debug(`could not read member log ${logPath}: ${safeMessage(err)}`);
    return undefined;
  }
}

/** Reads every member's own event log (steps, Kane's remarks, share URL). Missing logs are skipped. */
export async function readMemberLogs(summary: TestrunSummary): Promise<MemberLogs> {
  const logs: MemberLogs = new Map();
  for (const member of summary.members) {
    const memberLog = await readMemberLog(member.logPath);
    if (memberLog) logs.set(member.path, memberLog);
  }
  return logs;
}

function collectFailures(summary: TestrunSummary, logs: MemberLogs, flows: Flow[], projectDir: string): FlowFailure[] {
  return failedMembers(summary).map((member) => {
    const memberLog = logs.get(member.path);
    const wanted = member.failure?.stepIndex;
    const step =
      (wanted !== undefined ? memberLog?.steps.find((s) => s.index === wanted) : undefined) ?? memberLog?.failedStep;
    return { flow: flows.find((f) => sameFile(member.path, f.file, projectDir)), member, step, memberLog };
  });
}

function describeErrors(summary: TestrunSummary): string | undefined {
  const fromEvents = summary.errors
    .map((e) => [e.code, e.message, e.remedy ? `fix: ${e.remedy}` : undefined].filter(Boolean).join(": "))
    .filter(Boolean);
  const offenders = (summary.plan?.members ?? []).filter((m) => m.failure).map((m) => `${m.path}: ${m.failure}`);
  const all = [...fromEvents, ...offenders];
  return all.length ? redact(all.join("\n")) : undefined;
}

function spawnFailure(result: RunResult, config: KaneRunConfig): string {
  if (result.spawnError?.code === "ENOENT") {
    return `"${config.kaneBin}" was not found on PATH. Install Kane CLI with: npm install -g @testmuai/kane-cli`;
  }
  return `could not start ${config.kaneBin}: ${safeMessage(result.spawnError)}`;
}

/** Turns a finished kane-cli process into an outcome. Exit codes: 0 pass, 1 fail, 2 setup error, 3 timeout. */
export async function classifyRun(
  result: RunResult,
  summary: TestrunSummary,
  opts: Pick<RunKaneOptions, "config" | "flows" | "projectDir">,
  evidencePath: string | undefined,
): Promise<KaneOutcome> {
  const durationMs = result.durationMs;
  if (result.spawnError) return { kind: "error", exitCode: null, reason: spawnFailure(result, opts.config), durationMs };
  if (result.timedOut) {
    const reason = `Kane did not finish within ${opts.config.timeoutSec}s and was stopped`;
    return { kind: "timeout", reason, evidencePath, durationMs };
  }
  const memberLogs = await readMemberLogs(summary);
  const failures = collectFailures(summary, memberLogs, opts.flows, opts.projectDir);
  if (result.exitCode === 0 && failures.length === 0) return { kind: "passed", summary, evidencePath, memberLogs, durationMs };
  if (result.exitCode === 0 || result.exitCode === 1) {
    const detail = failures.length === 0 ? describeErrors(summary) ?? (stderrTail(result.stderr) || undefined) : undefined;
    return { kind: "failed", summary, failures, evidencePath, memberLogs, durationMs, detail };
  }
  if (result.exitCode === 3) {
    return { kind: "timeout", reason: "Kane reported the run as cancelled or timed out (exit 3)", evidencePath, durationMs };
  }
  const detail = describeErrors(summary) ?? (stderrTail(result.stderr) || undefined);
  const reason =
    result.exitCode === 2
      ? "Kane could not run the flows (exit 2: sign-in, setup or infrastructure problem)"
      : `kane-cli ended unexpectedly (exit ${result.exitCode ?? `signal ${result.signal ?? "?"}`})`;
  return { kind: "error", exitCode: result.exitCode, reason, detail, durationMs };
}

/** Runs the given flows as one `kane-cli testrun` execution and classifies the result. */
export async function runKane(opts: RunKaneOptions): Promise<KaneOutcome> {
  const args = buildTestrunArgs(opts.flows, opts.config, opts.label);
  log.info(`running: ${opts.config.kaneBin} ${args.join(" ")}`);
  const result = await runCommand(opts.config.kaneBin, args, {
    cwd: opts.projectDir,
    timeoutMs: opts.config.timeoutSec * 1000,
    killGraceMs: 20_000,
    onStdoutLine: (line) => {
      const event = parseNdjsonLine(line);
      if (event) opts.onEvent?.(event);
    },
  });
  if (opts.rawLogPrefix) await saveRaw(opts.rawLogPrefix, result);
  const summary = summarizeTestrunStream(parseNdjson(result.stdout).events);
  const hinted = evidenceHint(result.stderr);
  const evidencePath = hinted ? resolve(opts.projectDir, hinted) : undefined;
  log.info(`kane-cli exited ${result.exitCode ?? result.signal ?? "?"} after ${Math.round(result.durationMs / 1000)}s`);
  return classifyRun(result, summary, opts, evidencePath);
}
