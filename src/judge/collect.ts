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

function failureFacts(failure: FlowFailure | undefined, ev: StepEvidence | undefined): FlowFailureFacts {
  const step = failure?.step;
  return {
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
}

async function evidenceFor(ctx: Context, member: MemberResult, name: string, failed: boolean) {
  const pack = ctx.outcome.evidencePath;
  if (!pack) return { ev: undefined, shot: undefined };
  const flow = findFlow(member, ctx.flows);
  const target = { testId: member.testId, flowText: await flowText(ctx.paths, flow) };
  if (failed) {
    const step = member.failure?.stepIndex;
    const screenshotTo = join(ctx.paths.evidenceDir, `${safeName(name)}-step-${step ?? "x"}.png`);
    const ev = await readFailureEvidence(pack, { ...target, screenshotTo });
    return { ev, shot: ev?.screenshotPath };
  }
  const shot = await readProofScreenshot(pack, { ...target, screenshotTo: join(ctx.paths.evidenceDir, `${safeName(name)}-pass.png`) });
  return { ev: undefined, shot };
}

async function flowResult(ctx: Context, member: MemberResult): Promise<FlowResult> {
  const flow = findFlow(member, ctx.flows);
  const name = flow?.name ?? stem(member.path);
  const failed = member.status !== "passed" && member.status !== "skipped";
  const failure = ctx.outcome.kind === "failed" ? ctx.outcome.failures.find((f) => f.member.path === member.path) : undefined;
  const log = ctx.outcome.memberLogs.get(member.path);
  const { ev, shot } = await evidenceFor(ctx, member, name, failed).catch((err: unknown) => {
    logger.warn(`could not read the evidence for ${name}: ${safeMessage(err)}`);
    return { ev: undefined, shot: undefined };
  });
  return {
    name,
    file: flow?.file ?? member.path,
    title: flow?.title,
    status: member.status,
    attempts: 0,
    durationS: member.durationS,
    authored: member.authored || (log?.authored ?? 0) > 0,
    steps: stepsOf(log),
    failure: failed ? failureFacts(failure, ev) : undefined,
    screenshot: shot ? toPosix(relative(ctx.paths.dir, shot)) : undefined,
    shareUrl: log?.shareUrl,
    lastRunAt: ctx.at,
  };
}

/** One result per flow Kane ran, with the evidence a judge needs pulled out of the sealed pack. */
export async function collectFlowResults(outcome: Ran, flows: Flow[], paths: ProjectPaths, at: string): Promise<FlowResult[]> {
  const ctx: Context = { outcome, flows, paths, at };
  const members = outcome.summary.members.filter((m) => m.status !== "running");
  const results: FlowResult[] = [];
  for (const member of members) results.push(await flowResult(ctx, member));
  return results;
}
