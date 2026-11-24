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

/** One step of a Kane run, for the scorecard's replay: Kane's screenshot and its own line about the step. */
export interface ReplayStep {
  /** Project-relative screenshot. */
  file: string;
  kind?: string;
  status?: string;
  summary?: string;
}

/** One Kane run of a flow: enough to tell whether the very test that failed later passed. */
export interface FlowRunEntry {
  at: string;
  status: string;
  /** sha256 of the flow file's text when Kane ran it. */
  flowSha?: string;
  /** Fingerprint of the flow's check sentences alone, to tell a rewritten route from a rewritten check. */
  checksSha?: string;
  /** Test Manager link for this run, when Kane uploaded it. */
  shareUrl?: string;
  /** Project-relative screenshot Kane took in this run. */
  screenshot?: string;
  /** The run's steps, for the replay. */
  frames?: ReplayStep[];
  /** True when Kane's own bug verdict on this failing run confirmed a product bug. */
  bug?: boolean;
  /** Set when the run was pointed at another build than the flow's own `url:` (`--start-url`). */
  startUrl?: string;
  /** Steps Kane ran, and assert steps that passed, in this run. */
  steps?: number;
  asserts?: number;
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
  /** The latest run's steps, for the replay. */
  frames?: ReplayStep[];
  /** Assert steps in the latest run, counted from Kane's evidence pack. Undefined when no pack could be read. */
  asserts?: { total: number; passed: number };
  /** The claim this flow tests (the `cN` tag in its frontmatter), fixed when Kane ran it. */
  claim?: string;
  /** The flow's own start URL, and the URL the latest run was pointed at instead, if any. */
  url?: string;
  startUrl?: string;
  /** sha256 of the flow file's text in the latest run. */
  flowSha?: string;
  /** Fingerprint of the flow's check sentences in the latest run. */
  checksSha?: string;
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
  /** False when the run had Kane's self-healing off (`--no-adaptive-heal`): every replay ran as recorded. */
  heal?: boolean;
  /** sha256 of the sealed evidence pack file, taken right after the run. `report` hashes the pack again. */
  packSha256?: string;
  /** In a share copy (`kane-judge share`): sha256 of the pack as shared, with the Kane account and local paths removed. */
  sharedPackSha256?: string;
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
    const entry: FlowRunEntry = {
      at: flow.lastRunAt,
      status: flow.status,
      flowSha: flow.flowSha,
      checksSha: flow.checksSha,
      shareUrl: flow.shareUrl,
      screenshot: flow.screenshot,
      frames: flow.frames,
      bug: flow.failure?.bugVerdict?.confirmed,
      startUrl: flow.startUrl,
      steps: flow.steps.length,
      asserts: flow.asserts?.passed,
    };
    const history = [...(before?.history ?? []), entry];
    next.flows[flow.name] = { ...flow, attempts: (before?.attempts ?? 0) + 1, history };
  }
  return next;
}

/** The two Kane runs that show a fix worked: the same flow text failing, then passing. */
export interface FixProof {
  anchorAt: string;
  anchorFlow: string;
  failedFlow: string;
  failedAt: string;
  passedAt: string;
  failedShot?: string;
  passedShot?: string;
  /** The failing run's steps, so the scorecard can replay the test before the fix. */
  failedFrames?: ReplayStep[];
}

export interface ClaimRun extends FlowRunEntry {
  /** The flow file stem this run belongs to. */
  flow: string;
}

const failedRun = (run: FlowRunEntry) => run.status === "failed";

/**
 * Every Kane run of a flow and of any other flow that carries the same claim
 * tag, oldest first. Renaming a claim's flow file therefore doesn't start a new
 * history: the rewrite limit and the fix proof follow the claim, not the file.
 */
export function claimRuns(results: KaneResults, flow: FlowResult): ClaimRun[] {
  const flows = flow.claim ? Object.values(results.flows).filter((f) => f.claim === flow.claim) : [flow];
  return flows.flatMap((f) => (f.history ?? []).map((run) => ({ ...run, flow: f.name }))).sort((a, b) => a.at.localeCompare(b.at));
}

/** How many different flow texts Kane has run for this flow's claim (1 = never rewritten). Runs without a hash don't count. */
export function flowVersions(results: KaneResults, flow: FlowResult): number {
  return new Set(claimRuns(results, flow).map((run) => run.flowSha).filter(Boolean)).size;
}

/**
 * The proof that a fix worked: the claim's latest run passed with the same flow
 * text as the run that established the failure. That anchor is the first failing
 * run in which Kane's own bug verdict confirmed a product bug, or, when Kane
 * never confirmed one, the claim's very first failing run. A flow weakened after
 * that point can never count as a fix, however often it then fails and passes.
 */
export function fixProof(results: KaneResults, flow: FlowResult): FixProof | undefined {
  const runs = claimRuns(results, flow);
  const last = runs[runs.length - 1];
  if (!last || last.status !== "passed" || last.flow !== flow.name) return undefined;
  const failures = runs.filter(failedRun);
  const anchor = failures.find((run) => run.bug === true) ?? failures[0];
  if (!anchor?.flowSha || anchor.flowSha !== last.flowSha) return undefined;
  const lastFailure = [...failures].reverse().find((run) => run.flowSha === last.flowSha) ?? anchor;
  return { anchorAt: anchor.at, anchorFlow: anchor.flow, failedFlow: lastFailure.flow, failedAt: lastFailure.at, passedAt: last.at, failedShot: lastFailure.screenshot, passedShot: last.screenshot, failedFrames: lastFailure.frames };
}

export function isKaneResults(value: unknown): value is KaneResults {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === "string");
  const optionalString = (v: unknown) => v === undefined || typeof v === "string";
  const textFields = (v: Record<string, unknown>, keys: string[]) => keys.every(k => optionalString(v[k]));
  const counts = (v: unknown) => object(v) && Number.isInteger(v.total) && Number.isInteger(v.passed) && Number(v.passed) >= 0 && Number(v.total) >= Number(v.passed);
  const frames = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(f => object(f) && typeof f.file === "string" && textFields(f, ["kind", "status", "summary"])));
  const history = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(h => object(h) && typeof h.at === "string" && typeof h.status === "string" && textFields(h, ["flowSha", "checksSha", "screenshot", "shareUrl", "startUrl"]) && frames(h.frames)));
  if (!object(value) || value.version !== 1 || !Array.isArray(value.runs) || !object(value.flows)) return false;
  if (!value.runs.every(r => object(r) && typeof r.at === "string" && strings(r.flows) && ["passed", "failed", "error", "timeout"].includes(String(r.outcome)) && typeof r.durationS === "number" && optionalString(r.evidencePath) && optionalString(r.packSha256) && optionalString(r.sharedPackSha256) &&
    (r.kaneVerdict === undefined || (object(r.kaneVerdict) && typeof r.kaneVerdict.result === "string" && typeof r.kaneVerdict.policy === "string" && Array.isArray(r.kaneVerdict.gates) && r.kaneVerdict.gates.every(object) && strings(r.kaneVerdict.failedGates) && strings(r.kaneVerdict.erroredGates) && strings(r.kaneVerdict.warnings))))) return false;
  return Object.entries(value.flows).every(([name, f]) => object(f) && f.name === name && typeof f.file === "string" && typeof f.status === "string" && typeof f.lastRunAt === "string" && Array.isArray(f.steps) && f.steps.every(object) && optionalString(f.claim) && optionalString(f.flowSha) && optionalString(f.checksSha) && optionalString(f.startUrl) && optionalString(f.screenshot) && frames(f.frames) && (f.asserts === undefined || counts(f.asserts)) &&
    history(f.history) &&
    (f.failure === undefined || (object(f.failure) && Array.isArray(f.failure.console) && f.failure.console.every(object) && Array.isArray(f.failure.network) && f.failure.network.every(object))));
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
