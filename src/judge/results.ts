import { createHash } from "node:crypto";
import type { ConsoleEntry, NetworkFailure } from "../evidence/logs.js";
import type { KanePolicyVerdict } from "../kane/policy.js";
import type { KaneBugVerdict } from "../kane/testmd-stream.js";

/**
 * kane-results.json: what Kane found for each flow of a project, accumulated
 * across runs (the investigation loop re-runs single flows).
 */
export interface StepResult {
  index: number;
  heading?: string;
  status?: string;
  /** Kane's own words about the step. */
  detail?: string;
}

export interface FlowFailureFacts {
  stepIndex?: number;
  stepHeading?: string;
  /** Kane's explanation of the failing step. */
  kaneSays?: string;
  /** The error from Kane's failure record. */
  error?: string;
  pageUrl?: string;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  /** Kane's own triage of the failure: a lead for the judge, not a verdict. */
  triage?: { rootCause?: string; suggestedFix?: string; category?: string; confidence?: number; severity?: string; title?: string };
  /** Kane's bug verdict: did it confirm a product bug, or blame the test? */
  bugVerdict?: KaneBugVerdict;
}

/** One Kane run of a flow: enough to tell whether the very test that failed later passed. */
export interface FlowRunEntry {
  at: string;
  status: string;
  /** sha256 of the flow file's text when Kane ran it. */
  flowSha?: string;
  /** Test Manager link for this run, when Kane uploaded it. */
  shareUrl?: string;
  /** Project-relative screenshot Kane took in this run. */
  screenshot?: string;
}

const MAX_HISTORY = 30;

export interface FlowResult {
  /** File stem inside flows/, e.g. "02-apply-promo". */
  name: string;
  /** Project-relative flow file. */
  file: string;
  title?: string;
  status: string;
  /** How many times Kane has run this flow for this project. */
  attempts: number;
  durationS?: number;
  /** True when Kane authored the steps in this run (first run or after an edit). */
  authored: boolean;
  steps: StepResult[];
  failure?: FlowFailureFacts;
  /** Project-relative screenshot: the failing step, or the last step of a passing flow. */
  screenshot?: string;
  /** Test Manager link for the run, when Kane uploaded it. */
  shareUrl?: string;
  lastRunAt: string;
  /** sha256 of the flow file's text in the latest run. */
  flowSha?: string;
  /** Every Kane run of this flow, oldest first. */
  history?: FlowRunEntry[];
}

export interface RunRecord {
  at: string;
  flows: string[];
  outcome: "passed" | "failed" | "error" | "timeout";
  durationS: number;
  /** Project-relative evidence pack. */
  evidencePath?: string;
  /** Why Kane could not run (error/timeout outcomes). */
  reason?: string;
  detail?: string;
  /** Kane's own verdict on this run's sealed evidence pack (`kane-cli evidence verdict`). */
  kaneVerdict?: KanePolicyVerdict;
  /** Set when the run was pointed at a different start URL than the flows name (`--start-url`). */
  startUrl?: string;
}

export interface KaneResults {
  version: 1;
  runs: RunRecord[];
  flows: Record<string, FlowResult>;
}

export function emptyResults(): KaneResults {
  return { version: 1, runs: [], flows: {} };
}

/** Adds one run: its record, plus the latest result per flow (attempt counts and run history carry over). */
export function mergeRun(prev: KaneResults, run: RunRecord, flows: FlowResult[]): KaneResults {
  const next: KaneResults = { version: 1, runs: [...prev.runs, run], flows: { ...prev.flows } };
  for (const flow of flows) {
    const before = prev.flows[flow.name];
    const entry: FlowRunEntry = { at: flow.lastRunAt, status: flow.status, flowSha: flow.flowSha, shareUrl: flow.shareUrl, screenshot: flow.screenshot };
    const history = [...(before?.history ?? []), entry].slice(-MAX_HISTORY);
    next.flows[flow.name] = { ...flow, attempts: (before?.attempts ?? 0) + 1, history };
  }
  return next;
}

/**
 * The run that shows a fix worked: the flow's latest run passed, and the last
 * run that failed before it used the very same flow text. Undefined when Kane
 * never saw the flow fail, or when the flow was edited between the two runs.
 */
export function fixProof(flow: FlowResult): { failedAt: string; passedAt: string; failedShot?: string; passedShot?: string } | undefined {
  const history = flow.history ?? [];
  const last = history[history.length - 1];
  if (!last || last.status !== "passed") return undefined;
  const failed = [...history].reverse().find((h) => h.status !== "passed" && h.status !== "skipped");
  if (!failed || !failed.flowSha || failed.flowSha !== last.flowSha) return undefined;
  return { failedAt: failed.at, passedAt: last.at, failedShot: failed.screenshot, passedShot: last.screenshot };
}

export function isKaneResults(value: unknown): value is KaneResults {
  const v = value as KaneResults | undefined;
  return !!v && v.version === 1 && Array.isArray(v.runs) && typeof v.flows === "object" && v.flows !== null;
}

/** How many different texts of this flow Kane has run (1 = never rewritten). Runs from before hashes were recorded don't count. */
export function flowVersions(flow: FlowResult): number {
  return new Set((flow.history ?? []).map((h) => h.flowSha).filter(Boolean)).size;
}

/**
 * A short fingerprint of every Kane run in the results. A scorecard records the
 * one it was built from, so "is this scorecard up to date?" has a yes/no answer
 * that survives copying or cloning the folder (file times don't).
 */
export function resultsStamp(results: KaneResults): string {
  const runs = results.runs.map((r) => [r.at, r.outcome, r.flows]);
  return createHash("sha256").update(JSON.stringify(runs)).digest("hex").slice(0, 16);
}
