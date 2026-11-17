import { eventType, num, obj, str, type KaneEvent } from "./ndjson.js";

/** Untyped progress event of `kane-cli run --agent`: identified by a numeric `step`. */
export interface ProgressStep {
  step: number;
  status: string;
  remark?: string;
}

/** The stable terminal event of a one-shot run (also closes each step inside a testmd run). */
export interface RunEndInfo {
  status: string;
  summary?: string;
  oneLiner?: string;
  reason?: string;
  durationS?: number;
  credits?: number;
  finalState?: Record<string, unknown>;
  sessionDir?: string;
  testUrl?: string;
}

export interface RunStreamSummary {
  status: "passed" | "failed" | "unknown";
  steps: ProgressStep[];
  runEnd?: RunEndInfo;
  failedStep?: ProgressStep;
}

export function readProgress(e: KaneEvent): ProgressStep | undefined {
  if (eventType(e) !== undefined) return undefined;
  const step = num(e, "step");
  if (step === undefined) return undefined;
  return { step, status: str(e, "status") ?? "unknown", remark: str(e, "remark") };
}

export function readRunEnd(e: KaneEvent): RunEndInfo | undefined {
  if (eventType(e) !== "run_end") return undefined;
  return {
    status: str(e, "status") ?? "unknown",
    summary: str(e, "summary"),
    oneLiner: str(e, "one_liner"),
    reason: str(e, "reason"),
    durationS: num(e, "duration"),
    credits: num(e, "credits") ?? num(e, "credits_consumed"),
    finalState: obj(e, "final_state"),
    sessionDir: str(e, "session_dir"),
    testUrl: str(e, "test_url"),
  };
}

function normalizeStatus(status: string | undefined): RunStreamSummary["status"] {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "unknown";
}

/** Summarizes `kane-cli run --agent` output: steps (latest status per step) and the run_end verdict. */
export function summarizeRunStream(events: KaneEvent[]): RunStreamSummary {
  const steps = new Map<number, ProgressStep>();
  let runEnd: RunEndInfo | undefined;
  for (const e of events) {
    const progress = readProgress(e);
    if (progress) {
      const prev = steps.get(progress.step);
      steps.set(progress.step, { ...progress, remark: progress.remark ?? prev?.remark });
      continue;
    }
    runEnd = readRunEnd(e) ?? runEnd;
  }
  const ordered = [...steps.values()].sort((a, b) => a.step - b.step);
  return {
    status: normalizeStatus(runEnd?.status),
    steps: ordered,
    runEnd,
    failedStep: ordered.find((s) => s.status === "failed"),
  };
}

/** Best one-line explanation of a run_end, preferring the failure reason when it adds information. */
export function describeRunEnd(info: RunEndInfo): string | undefined {
  const main = info.summary ?? info.oneLiner;
  if (info.reason && main && !main.includes(info.reason) && info.reason !== "Objective completed") {
    return `${main} (${info.reason})`;
  }
  return main ?? info.reason;
}
