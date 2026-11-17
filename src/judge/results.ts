import type { ConsoleEntry, NetworkFailure } from "../evidence/logs.js";

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
}

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
}

export interface KaneResults {
  version: 1;
  runs: RunRecord[];
  flows: Record<string, FlowResult>;
}

export function emptyResults(): KaneResults {
  return { version: 1, runs: [], flows: {} };
}

/** Adds one run: its record, plus the latest result per flow (attempt counts carry over). */
export function mergeRun(prev: KaneResults, run: RunRecord, flows: FlowResult[]): KaneResults {
  const next: KaneResults = { version: 1, runs: [...prev.runs, run], flows: { ...prev.flows } };
  for (const flow of flows) {
    const attempts = (prev.flows[flow.name]?.attempts ?? 0) + 1;
    next.flows[flow.name] = { ...flow, attempts };
  }
  return next;
}

export function isKaneResults(value: unknown): value is KaneResults {
  const v = value as KaneResults | undefined;
  return !!v && v.version === 1 && Array.isArray(v.runs) && typeof v.flows === "object" && v.flows !== null;
}
