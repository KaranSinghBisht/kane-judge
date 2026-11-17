import { eventType, num, obj, readErrorEvent, str, type KaneErrorEvent, type KaneEvent } from "./ndjson.js";
import { describeRunEnd, readProgress, readRunEnd } from "./run-stream.js";

/** One `## ` step of a `_test.md` file, as reported by `testmd run --agent`. */
export interface TestMdStep {
  index: number;
  heading?: string;
  status?: string;
  durationS?: number;
  /** Kane's own words about what happened in the step (last inner summary/remark). */
  detail?: string;
  failedSubStep?: number;
  replayed?: boolean;
}

export interface TestMdSummary {
  status: "passed" | "failed" | "unknown";
  durationS?: number;
  sessionId?: string;
  shareUrl?: string;
  steps: TestMdStep[];
  failedStep?: TestMdStep;
  authored?: number;
  replayed?: number;
  errors: KaneErrorEvent[];
}

interface Acc {
  steps: Map<number, TestMdStep>;
  /** Steps whose `detail` already holds a failure explanation. */
  failureDetail: Set<number>;
  current?: number;
  summary: TestMdSummary;
}

function stepAt(acc: Acc, index: number): TestMdStep {
  let step = acc.steps.get(index);
  if (!step) {
    step = { index };
    acc.steps.set(index, step);
  }
  return step;
}

/** Inner events (per-step mini stream) can say why a step failed. */
function innerDetail(e: KaneEvent): { text: string; failed: boolean } | undefined {
  const type = eventType(e);
  if (type === "step_end") {
    const text = str(e, "summary") ?? str(e, "remark");
    return text ? { text, failed: str(e, "status") === "failed" } : undefined;
  }
  const runEnd = readRunEnd(e);
  if (runEnd) {
    const text = describeRunEnd(runEnd);
    return text ? { text, failed: runEnd.status === "failed" } : undefined;
  }
  const progress = readProgress(e);
  if (progress?.remark) return { text: progress.remark, failed: progress.status === "failed" };
  return undefined;
}

function applyInner(acc: Acc, e: KaneEvent): void {
  if (acc.current === undefined) return;
  const step = stepAt(acc, acc.current);
  if (eventType(e) === "step_event" && str(e, "event") === "replay_started") step.replayed = true;
  const detail = innerDetail(e);
  if (!detail) return;
  // The latest failure explanation wins; plain progress text never overwrites one.
  if (detail.failed || !acc.failureDetail.has(step.index)) {
    step.detail = detail.text;
    if (detail.failed) acc.failureDetail.add(step.index);
  }
}

function applyFileLevel(acc: Acc, e: KaneEvent): boolean {
  const type = eventType(e);
  if (type === "test_md_step_start") {
    const index = num(e, "step_index");
    if (index !== undefined) {
      acc.current = index;
      stepAt(acc, index).heading = str(e, "heading") ?? stepAt(acc, index).heading;
    }
    return true;
  }
  if (type === "test_md_step_end") {
    const index = num(e, "step_index") ?? acc.current;
    if (index !== undefined) {
      const step = stepAt(acc, index);
      step.status = str(e, "status") ?? step.status;
      step.durationS = num(e, "duration_s") ?? step.durationS;
      step.failedSubStep = num(e, "failed_sub_step_index") ?? step.failedSubStep;
    }
    acc.current = undefined;
    return true;
  }
  if (type === "test_md_summary") {
    const steps = obj(e, "steps");
    acc.summary.authored = steps ? num(steps, "author_decisions") : undefined;
    acc.summary.replayed = steps ? num(steps, "replay_decisions") : undefined;
    acc.summary.durationS = num(e, "duration_s") ?? acc.summary.durationS;
    acc.summary.status = toStatus(str(e, "overall_status")) ?? acc.summary.status;
    return true;
  }
  if (type === "test_md_done") {
    acc.summary.status = toStatus(str(e, "overall_status")) ?? acc.summary.status;
    acc.summary.durationS = num(e, "duration_s") ?? acc.summary.durationS;
    acc.summary.sessionId = str(e, "session_id");
    acc.summary.shareUrl = str(e, "share_url");
    return true;
  }
  return false;
}

function toStatus(value: string | undefined): TestMdSummary["status"] | undefined {
  if (value === "passed" || value === "failed") return value;
  return undefined;
}

/** Summarizes a `testmd run --agent` stream (also the per-member log of a testrun). */
export function summarizeTestMdStream(events: KaneEvent[]): TestMdSummary {
  const acc: Acc = {
    steps: new Map(),
    failureDetail: new Set(),
    summary: { status: "unknown", steps: [], errors: [] },
  };
  for (const e of events) {
    const error = readErrorEvent(e);
    if (error) {
      acc.summary.errors.push(error);
      continue;
    }
    if (!applyFileLevel(acc, e)) applyInner(acc, e);
  }
  const steps = [...acc.steps.values()].sort((a, b) => a.index - b.index);
  acc.summary.steps = steps;
  acc.summary.failedStep = steps.find((s) => s.status === "failed");
  if (acc.summary.status === "unknown" && acc.summary.failedStep) acc.summary.status = "failed";
  return acc.summary;
}
