import { arr, eventType, num, obj, readErrorEvent, str, type KaneErrorEvent, type KaneEvent } from "./ndjson.js";

export type MemberStatus = "passed" | "failed" | "broken" | "interrupted" | "skipped" | string;

export interface MemberResult {
  path: string;
  testId?: string;
  status: MemberStatus;
  durationS?: number;
  sessionId?: string;
  /** Absolute path of the member's own testmd event log. */
  logPath?: string;
  failure?: { message?: string; stepIndex?: number };
  /** True when the test had no recording yet and was authored in this run. */
  authored: boolean;
}

export interface PlanMember {
  path: string;
  failure?: string;
}

export interface TestrunSummary {
  status: "passed" | "failed" | "cancelled" | "refused" | "unknown";
  executionId?: string;
  members: MemberResult[];
  plan?: { valid: boolean; members: PlanMember[] };
  totals?: { tests?: number; passed?: number; failed?: number; broken?: number; skipped?: number; authored?: number };
  durationS?: number;
  cliVersion?: string;
  errors: KaneErrorEvent[];
  warnings: Array<{ code?: string; message?: string }>;
}

const MEMBER_END = new Set(["testrun_member_end", "testrun_authored_member_end"]);
const MEMBER_START = new Set(["testrun_member_start", "testrun_authored_member_start"]);

function readMember(e: KaneEvent, authored: boolean): MemberResult {
  const failure = obj(e, "failure");
  return {
    path: str(e, "path") ?? "(unknown test)",
    testId: str(e, "test_id"),
    status: str(e, "status") ?? "unknown",
    durationS: num(e, "duration_s"),
    sessionId: str(e, "session_id"),
    logPath: str(e, "log_path"),
    failure: failure ? { message: str(failure, "message"), stepIndex: num(failure, "step_index") } : undefined,
    authored,
  };
}

function readPlan(e: KaneEvent): TestrunSummary["plan"] {
  const members = arr(e, "members")
    .filter((m): m is KaneEvent => typeof m === "object" && m !== null)
    .map((m) => ({ path: str(m, "path") ?? "(unknown test)", failure: str(m, "failure") }));
  return { valid: e.valid !== false, members };
}

function readTotals(e: KaneEvent): TestrunSummary["totals"] {
  const t = obj(e, "totals");
  if (!t) return undefined;
  return {
    tests: num(t, "tests"),
    passed: num(t, "passed"),
    failed: num(t, "failed"),
    broken: num(t, "broken"),
    skipped: num(t, "skipped"),
    authored: num(t, "authored"),
  };
}

function toOverall(value: string | undefined): TestrunSummary["status"] | undefined {
  if (value === "passed" || value === "failed" || value === "cancelled" || value === "refused") return value;
  return undefined;
}

/** Same test may appear in a replay pass and an author pass; the last end event wins. Match by file name. */
function upsertMember(members: MemberResult[], next: MemberResult): void {
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const idx = members.findIndex((m) => base(m.path) === base(next.path));
  if (idx >= 0) members[idx] = { ...members[idx], ...next } as MemberResult;
  else members.push(next);
}

function applyEvent(s: TestrunSummary, e: KaneEvent): void {
  const type = eventType(e);
  if (!type) return;
  if (type === "stream_start") s.cliVersion = str(e, "cli_version");
  else if (type === "testrun_plan") s.plan = readPlan(e);
  else if (type === "testrun_start") s.executionId = str(e, "execution_id") ?? s.executionId;
  else if (MEMBER_START.has(type)) upsertMember(s.members, { ...readMember(e, type.includes("authored")), status: "running" });
  else if (MEMBER_END.has(type)) upsertMember(s.members, readMember(e, type.includes("authored")));
  else if (type === "testrun_summary") {
    s.totals = readTotals(e);
    s.durationS = num(e, "duration_s");
    const execution = obj(e, "execution");
    s.executionId = (execution && str(execution, "id")) ?? s.executionId;
  } else if (type === "testrun_done") {
    s.executionId = str(e, "execution_id") ?? s.executionId;
    s.status = toOverall(str(e, "overall_status")) ?? s.status;
  } else if (type === "warning") s.warnings.push({ code: str(e, "code"), message: str(e, "message") });
}

/** Summarizes `kane-cli testrun run --agent` output. Stops at `testrun_done`. */
export function summarizeTestrunStream(events: KaneEvent[]): TestrunSummary {
  const s: TestrunSummary = { status: "unknown", members: [], errors: [], warnings: [] };
  for (const e of events) {
    const error = readErrorEvent(e);
    if (error) s.errors.push(error);
    else applyEvent(s, e);
    if (eventType(e) === "testrun_done") break;
  }
  if (s.plan && !s.plan.valid && s.status === "unknown") s.status = "refused";
  return s;
}

export function failedMembers(s: TestrunSummary): MemberResult[] {
  return s.members.filter((m) => m.status !== "passed" && m.status !== "skipped" && m.status !== "running");
}
