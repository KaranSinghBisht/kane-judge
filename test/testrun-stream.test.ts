import { describe, expect, it } from "vitest";
import { parseNdjson } from "../src/kane/ndjson.js";
import { failedMembers, summarizeTestrunStream } from "../src/kane/testrun-stream.js";
import { ev, fixture, memberEnd, memberStart, testrunDone } from "./helpers/events.js";
import { makeMember, makeSummary } from "./helpers/builders.js";
import { must } from "./helpers/tmp.js";

const CHECKOUT = "kane/flows/checkout_test.md";
const PROMO = "kane/flows/promo_test.md";

function summarizeFixture(name: string) {
  return summarizeTestrunStream(parseNdjson(fixture(name)).events);
}

describe("summarizeTestrunStream on a recorded failing run", () => {
  const summary = summarizeFixture("testrun-failed.ndjson");

  it("reports the overall status and execution id from testrun_done", () => {
    expect(summary.status).toBe("failed");
    expect(summary.executionId).toBe("exec-1");
  });

  it("reads the CLI version from stream_start", () => {
    expect(summary.cliVersion).toBe("0.10.5");
  });

  it("reads the plan with its members and validity", () => {
    expect(summary.plan).toEqual({
      valid: true,
      members: [{ path: CHECKOUT }, { path: PROMO }],
    });
  });

  it("reads the totals and duration from testrun_summary", () => {
    expect(summary.totals).toMatchObject({ passed: 1, failed: 1, broken: 0, skipped: 0 });
    expect(summary.durationS).toBe(42.4);
  });

  it("keeps one member per flow, in the order they started", () => {
    expect(summary.members.map((m) => m.path)).toEqual([CHECKOUT, PROMO]);
  });

  it("records the failing member's message and step index", () => {
    const checkout = must(summary.members.find((m) => m.path === CHECKOUT));
    expect(checkout).toMatchObject({
      status: "failed",
      testId: "t-1",
      durationS: 30.1,
      failure: { message: "step 1 failed: Apply the SAVE10 code", stepIndex: 1 },
    });
  });

  it("records a passing member without a failure", () => {
    const promo = must(summary.members.find((m) => m.path === PROMO));
    expect(promo).toMatchObject({ status: "passed", durationS: 12.5, authored: false });
    expect(promo.failure).toBeUndefined();
  });

  it("collects no errors or warnings from a clean stream", () => {
    expect(summary.errors).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });
});

describe("summarizeTestrunStream member events", () => {
  it("keeps the member log path from testrun_member_start after the member ends", () => {
    const summary = summarizeTestrunStream([
      memberStart(CHECKOUT, { log_path: "/abs/checkout.ndjson" }),
      memberEnd(CHECKOUT, "failed", { failure: { message: "boom", step_index: 1 } }),
    ]);
    expect(must(summary.members[0]).logPath).toBe("/abs/checkout.ndjson");
  });

  it("marks a member as running between its start and end events", () => {
    const summary = summarizeTestrunStream([memberStart(CHECKOUT)]);
    expect(summary.members).toEqual([expect.objectContaining({ path: CHECKOUT, status: "running", authored: false })]);
  });

  it("flags members of the authored variants as authored", () => {
    const summary = summarizeFixture("testrun-passed.ndjson");
    const promo = must(summary.members.find((m) => m.path === PROMO));
    const checkout = must(summary.members.find((m) => m.path === CHECKOUT));
    expect(promo.authored).toBe(true);
    expect(checkout.authored).toBe(false);
  });

  it("lets the authored end event win over the replay pass of the same file", () => {
    const summary = summarizeTestrunStream([
      memberStart(PROMO),
      memberEnd(PROMO, "failed"),
      ev("testrun_authored_member_start", { path: PROMO, test_id: "t-1" }),
      ev("testrun_authored_member_end", { path: PROMO, test_id: "t-1", status: "passed", duration_s: 40 }),
    ]);
    expect(summary.members).toHaveLength(1);
    expect(summary.members[0]).toMatchObject({ status: "passed", authored: true, durationS: 40 });
  });

  it("matches a member end to its start by file name when the paths are spelled differently", () => {
    const summary = summarizeTestrunStream([
      memberStart(CHECKOUT),
      memberEnd(`/Users/dev/app/${CHECKOUT}`, "passed"),
    ]);
    expect(summary.members).toHaveLength(1);
    expect(summary.members[0]).toMatchObject({ status: "passed", path: `/Users/dev/app/${CHECKOUT}` });
  });

  it("adds a member that ends without ever starting", () => {
    const summary = summarizeTestrunStream([memberEnd(PROMO, "failed")]);
    expect(summary.members).toEqual([expect.objectContaining({ path: PROMO, status: "failed" })]);
  });

  it("names a member without a path as an unknown test", () => {
    const summary = summarizeTestrunStream([ev("testrun_member_end", { status: "failed" })]);
    expect(must(summary.members[0]).path).toBe("(unknown test)");
  });

  it("gives a member end without a status the status unknown", () => {
    const summary = summarizeTestrunStream([ev("testrun_member_end", { path: CHECKOUT })]);
    expect(must(summary.members[0]).status).toBe("unknown");
  });

  it("ignores progress and evidence-ingest events", () => {
    const summary = summarizeTestrunStream([
      ev("testrun_progress", { running: [], pending: 0, done: 1, total: 2 }),
      ev("testrun_evidence_ingest", { status: "ok", evidence_id: "exec-1" }),
    ]);
    expect(summary).toEqual(makeSummary());
  });

  it("ignores events without a type", () => {
    expect(summarizeTestrunStream([{ step: 1, status: "failed" }])).toEqual(makeSummary());
  });
});

describe("summarizeTestrunStream stream end", () => {
  it("stops reading at testrun_done", () => {
    const summary = summarizeTestrunStream([
      memberEnd(CHECKOUT, "failed"),
      testrunDone("failed"),
      ev("error", { code: "LATE", message: "after done" }),
      memberEnd(PROMO, "passed"),
      testrunDone("passed", { execution_id: "exec-2" }),
    ]);
    expect(summary.status).toBe("failed");
    expect(summary.executionId).toBe("exec-1");
    expect(summary.members.map((m) => m.path)).toEqual([CHECKOUT]);
    expect(summary.errors).toEqual([]);
  });

  it.each(["passed", "failed", "cancelled", "refused"])("accepts %s as an overall status", (status) => {
    expect(summarizeTestrunStream([testrunDone(status)]).status).toBe(status);
  });

  it("leaves the status unknown for an overall status it does not recognise", () => {
    expect(summarizeTestrunStream([testrunDone("exploded")]).status).toBe("unknown");
  });

  it("reports unknown when the stream ends without testrun_done", () => {
    expect(summarizeTestrunStream([memberEnd(CHECKOUT, "passed")]).status).toBe("unknown");
  });

  it("returns an empty unknown summary for no events", () => {
    expect(summarizeTestrunStream([])).toEqual(makeSummary());
  });

  it("takes the execution id from testrun_start, then testrun_summary, then testrun_done", () => {
    const events = [ev("testrun_start", { execution_id: "from-start" })];
    expect(summarizeTestrunStream(events).executionId).toBe("from-start");
    events.push(ev("testrun_summary", { execution: { id: "from-summary" } }));
    expect(summarizeTestrunStream(events).executionId).toBe("from-summary");
    events.push(testrunDone("passed", { execution_id: "from-done" }));
    expect(summarizeTestrunStream(events).executionId).toBe("from-done");
  });

  it("leaves totals undefined when testrun_summary has none", () => {
    expect(summarizeTestrunStream([ev("testrun_summary", { duration_s: 3 })]).totals).toBeUndefined();
  });
});

describe("summarizeTestrunStream refusals, errors and warnings", () => {
  it("reports a refused run when the plan is invalid and no testrun_done follows", () => {
    const summary = summarizeFixture("testrun-refused.ndjson");
    expect(summary.status).toBe("refused");
    expect(summary.plan?.valid).toBe(false);
  });

  it("lists the offending files of an invalid plan with Kane's reason", () => {
    const summary = summarizeFixture("testrun-refused.ndjson");
    expect(summary.plan?.members).toEqual([
      { path: "kane/flows/ok_test.md" },
      { path: "kane/flows/broken_test.md", failure: "frontmatter: url is required" },
    ]);
  });

  it("collects error events with code, message and remedy", () => {
    const summary = summarizeFixture("testrun-refused.ndjson");
    expect(summary.errors).toEqual([
      { code: "INVALID_TESTRUN_PLAN", message: "1 of 2 test files is invalid", remedy: "fix the listed files and re-run" },
    ]);
  });

  it("keeps the status from testrun_done when the plan was invalid but the run still finished", () => {
    const plan = ev("testrun_plan", { members: [], valid: false });
    expect(summarizeTestrunStream([plan, testrunDone("cancelled")]).status).toBe("cancelled");
  });

  it("treats a plan without a valid flag as valid", () => {
    const summary = summarizeTestrunStream([ev("testrun_plan", { members: [{ path: CHECKOUT }] })]);
    expect(summary.plan?.valid).toBe(true);
    expect(summary.status).toBe("unknown");
  });

  it("collects warning events", () => {
    const summary = summarizeTestrunStream([ev("warning", { code: "SLOW", message: "upload is slow" })]);
    expect(summary.warnings).toEqual([{ code: "SLOW", message: "upload is slow" }]);
  });

  it("does not let an error event touch the members", () => {
    const summary = summarizeTestrunStream([ev("error", { code: "X", message: "m", path: CHECKOUT, status: "failed" })]);
    expect(summary.members).toEqual([]);
  });
});

describe("failedMembers", () => {
  it("excludes passed, skipped and still-running members", () => {
    const summary = makeSummary({
      members: [
        makeMember("a", "passed"),
        makeMember("b", "skipped"),
        makeMember("c", "running"),
        makeMember("d", "failed"),
      ],
    });
    expect(failedMembers(summary).map((m) => m.path)).toEqual(["d"]);
  });

  it.each(["failed", "broken", "interrupted", "unknown"])("includes a member whose status is %s", (status) => {
    expect(failedMembers(makeSummary({ members: [makeMember("a", status)] }))).toHaveLength(1);
  });
});
