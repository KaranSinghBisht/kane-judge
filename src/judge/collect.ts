import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { readFailureEvidence, readProofScreenshot, type StepEvidence } from "../evidence/pack.js";
import type { Flow } from "../flows/discover.js";
import type { FlowFailure, KaneOutcome } from "../kane/runner.js";
import type { TestMdSummary } from "../kane/testmd-stream.js";
import type { MemberResult } from "../kane/testrun-stream.js";
import { safeMessage } from "../shared/errors.js";
import { toPosix } from "../shared/fs.js";
import { log as logger } from "../shared/logger.js";
import type { FlowFailureFacts, FlowResult, StepResult } from "./results.js";
import type { ProjectPaths } from "./workspace.js";

type Ran = Extract<KaneOutcome, { kind: "passed" | "failed" }>;

const stem = (path: string) => basename(path).replace(/_test\.md$/, "");
const safeName = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, "-");

function findFlow(member: MemberResult, flows: Flow[]): Flow | undefined {
  return flows.find((f) => basename(f.file) === basename(member.path));
}

function stepsOf(log: TestMdSummary | undefined): StepResult[] {
  return (log?.steps ?? []).map((s) => ({ index: s.index, heading: s.heading, status: s.status, detail: s.detail }));
}

async function flowText(paths: ProjectPaths, flow: Flow | undefined): Promise<string | undefined> {
  return flow ? readFile(join(paths.dir, flow.file), "utf8").catch(() => undefined) : undefined;
}

function failureFacts(failure: FlowFailure | undefined, ev: StepEvidence | undefined, log: TestMdSummary | undefined): FlowFailureFacts {
  const step = failure?.step;
  return {
    bugVerdict: log?.bugVerdict,
    stepIndex: step?.index ?? failure?.member.failure?.stepIndex,
    stepHeading: step?.heading,
    kaneSays: step?.detail ?? failure?.member.failure?.message,
    error: ev?.error,
    pageUrl: ev?.pageUrl,
    console: ev?.console ?? [],
    network: ev?.network ?? [],
    triage: ev?.triage,
  };
}

interface Context {
  outcome: Ran;
  flows: Flow[];
  paths: ProjectPaths;
  at: string;
  /** How many times Kane ran each flow before this run. */
  earlierRuns: Record<string, number>;
}

async function evidenceFor(ctx: Context, member: MemberResult, name: string, failed: boolean, text: string | undefined) {
  const pack = ctx.outcome.evidencePath;
  if (!pack) return { ev: undefined, shot: undefined };
  const target = { testId: member.testId, flowText: text };
  // One file per run, so a later run never overwrites the screenshot of an earlier one (a fix needs its "before").
  const base = join(ctx.paths.evidenceDir, `${safeName(name)}-run${(ctx.earlierRuns[name] ?? 0) + 1}`);
  if (failed) {
    const ev = await readFailureEvidence(pack, { ...target, screenshotTo: `${base}-failed.png` });
    return { ev, shot: ev?.screenshotPath };
  }
  const shot = await readProofScreenshot(pack, { ...target, screenshotTo: `${base}-passed.png` });
  return { ev: undefined, shot };
}

/** Kane reports a flow it could not parse into steps as passed. Its own log shows it ran nothing. */
export const NO_STEPS = "no-steps";
const NO_STEPS_NOTE = "Kane reported this flow as passed but its log shows no steps were run, so nothing was checked. The flow needs `## ` steps Kane can execute.";

async function flowResult(ctx: Context, member: MemberResult): Promise<FlowResult> {
  const flow = findFlow(member, ctx.flows);
  const name = flow?.name ?? stem(member.path);
  const log = ctx.outcome.memberLogs.get(member.path);
  const empty = member.status === "passed" && log !== undefined && log.steps.length === 0;
  const status = empty ? NO_STEPS : member.status;
  const failed = status !== "passed" && status !== "skipped";
  const failure = ctx.outcome.kind === "failed" ? ctx.outcome.failures.find((f) => f.member.path === member.path) : undefined;
  const text = await flowText(ctx.paths, flow);
  const { ev, shot } = await evidenceFor(ctx, member, name, failed, text).catch((err: unknown) => {
    logger.warn(`could not read the evidence for ${name}: ${safeMessage(err)}`);
    return { ev: undefined, shot: undefined };
  });
  return {
    name,
    file: flow?.file ?? member.path,
    title: flow?.title,
    status,
    attempts: 0,
    durationS: member.durationS,
    authored: member.authored || (log?.authored ?? 0) > 0,
    steps: stepsOf(log),
    failure: failed ? { ...failureFacts(failure, ev, log), ...(empty ? { kaneSays: NO_STEPS_NOTE } : {}) } : undefined,
    screenshot: shot ? toPosix(relative(ctx.paths.dir, shot)) : undefined,
    shareUrl: log?.shareUrl,
    lastRunAt: ctx.at,
    flowSha: text === undefined ? undefined : createHash("sha256").update(text).digest("hex"),
  };
}

/** One result per flow Kane ran, with the evidence a judge needs pulled out of the sealed pack. */
export async function collectFlowResults(outcome: Ran, flows: Flow[], paths: ProjectPaths, at: string, earlierRuns: Record<string, number> = {}): Promise<FlowResult[]> {
  const ctx: Context = { outcome, flows, paths, at, earlierRuns };
  const members = outcome.summary.members.filter((m) => m.status !== "running");
  const results: FlowResult[] = [];
  for (const member of members) results.push(await flowResult(ctx, member));
  return results;
}
