import { relative } from "node:path";
import type { ConsoleEntry, NetworkFailure } from "../evidence/logs.js";
import type { StepEvidence } from "../evidence/pack.js";
import type { Flow } from "../flows/discover.js";
import type { FlowFailure, KaneOutcome } from "../kane/runner.js";
import type { MemberResult } from "../kane/testrun-stream.js";
import { toPosix } from "../shared/fs.js";

/** One failing flow, with everything the report needs, already flattened. */
export interface FailureView {
  flowName: string;
  flowFile: string;
  status: string;
  stepIndex?: number;
  stepHeading?: string;
  /** Kane's own explanation of the failing step. */
  kaneSays?: string;
  error?: string;
  pageUrl?: string;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  triage?: { rootCause?: string; suggestedFix?: string };
  /** Project-relative path of the extracted screenshot. */
  screenshotPath?: string;
  authored: boolean;
}

export interface PassedView {
  flowName: string;
  durationS?: number;
  authored: boolean;
}

export interface RunView {
  passed: PassedView[];
  failures: FailureView[];
  totalFlows: number;
  durationS: number;
  /** Project-relative path of the sealed evidence pack. */
  evidencePath?: string;
  /** Kane's error output when it failed without per-flow detail. */
  detail?: string;
}

function flowNameFor(member: MemberResult, flows: Flow[]): string {
  const base = member.path.split(/[\\/]/).pop() ?? member.path;
  return flows.find((f) => f.file.endsWith(base))?.name ?? base.replace(/_test\.md$/, "");
}

function rel(projectDir: string, abs: string | undefined): string | undefined {
  if (!abs) return undefined;
  const r = toPosix(relative(projectDir, abs));
  return r.startsWith("..") ? toPosix(abs) : r;
}

function failureView(f: FlowFailure, flows: Flow[], ev: StepEvidence | undefined, projectDir: string): FailureView {
  const step = f.step;
  return {
    flowName: f.flow?.name ?? flowNameFor(f.member, flows),
    flowFile: f.flow?.file ?? f.member.path,
    status: f.member.status,
    stepIndex: step?.index ?? f.member.failure?.stepIndex,
    stepHeading: step?.heading,
    kaneSays: step?.detail ?? f.member.failure?.message,
    error: ev?.error,
    pageUrl: ev?.pageUrl,
    console: ev?.console ?? [],
    network: ev?.network ?? [],
    triage: ev?.triage,
    screenshotPath: rel(projectDir, ev?.screenshotPath),
    authored: f.member.authored,
  };
}

/** Builds the report view of a finished Kane run. `evidence` is keyed by member path. */
export function buildRunView(
  outcome: Extract<KaneOutcome, { kind: "passed" | "failed" }>,
  flows: Flow[],
  evidence: Map<string, StepEvidence>,
  projectDir: string,
): RunView {
  const failures = outcome.kind === "failed" ? outcome.failures : [];
  const failedPaths = new Set(failures.map((f) => f.member.path));
  const passed = outcome.summary.members
    .filter((m) => m.status === "passed" && !failedPaths.has(m.path))
    .map((m) => ({ flowName: flowNameFor(m, flows), durationS: m.durationS, authored: m.authored }));
  return {
    passed,
    failures: failures.map((f) => failureView(f, flows, evidence.get(f.member.path), projectDir)),
    totalFlows: Math.max(outcome.summary.members.length, flows.length),
    durationS: Math.round(outcome.summary.durationS ?? outcome.durationMs / 1000),
    evidencePath: rel(projectDir, outcome.evidencePath),
    detail: outcome.kind === "failed" ? outcome.detail : undefined,
  };
}
