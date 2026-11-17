import { describe, expect, it } from "vitest";
import { parseNdjson } from "../src/kane/ndjson.js";
import { summarizeTestMdStream } from "../src/kane/testmd-stream.js";
import { ev, fixture, progressEv } from "./helpers/events.js";
import { must } from "./helpers/tmp.js";

const stepStart = (index: number, heading?: string) =>
  ev("test_md_step_start", { step_index: index, ...(heading ? { heading } : {}) });
const stepEnd = (index: number, status: string, fields: Record<string, unknown> = {}) =>
  ev("test_md_step_end", { step_index: index, status, duration_s: 5, ...fields });
const innerStepEnd = (status: string, summary: string) => ev("step_end", { index: 0, status, summary });
const runEnd = (status: string, fields: Record<string, unknown> = {}) => ev("run_end", { status, ...fields });

describe("summarizeTestMdStream on a recorded failing member log", () => {
  const summary = summarizeTestMdStream(parseNdjson(fixture("testmd-failed.ndjson")).events);

  it("reports the overall status from test_md_done", () => {
    expect(summary.status).toBe("failed");
  });

  it("lists the steps in order with their headings and statuses", () => {
    expect(summary.steps.map((s) => [s.index, s.heading, s.status])).toEqual([
      [0, "Put a notebook in the cart", "passed"],
      [1, "Apply the SAVE10 code", "failed"],
    ]);
  });

  it("points at the first failing step", () => {
    expect(summary.failedStep).toMatchObject({ index: 1, heading: "Apply the SAVE10 code", durationS: 20 });
  });

  it("keeps Kane's own words about why the step failed", () => {
    expect(summary.failedStep?.detail).toContain("The order summary shows no Total row");
  });

  it("reads author and replay decision counts from test_md_summary", () => {
    expect(summary.authored).toBe(3);
    expect(summary.replayed).toBe(0);
  });

  it("reads the session id and share link from test_md_done", () => {
    expect(summary.sessionId).toBe("sess-1");
    expect(summary.shareUrl).toBe("https://example.test/run/1");
    expect(summary.durationS).toBe(45);
  });
});

describe("summarizeTestMdStream step events", () => {
  it("takes the step status and duration from test_md_step_end", () => {
    const { steps } = summarizeTestMdStream([stepStart(0, "Open"), stepEnd(0, "passed", { duration_s: 7.5 })]);
    expect(steps).toEqual([{ index: 0, heading: "Open", status: "passed", durationS: 7.5, failedSubStep: undefined }]);
  });

  it("records the failed sub-step index when Kane gives one", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), stepEnd(0, "failed", { failed_sub_step_index: 2 })]);
    expect(must(steps[0]).failedSubStep).toBe(2);
  });

  it("treats a null failed_sub_step_index as absent", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), stepEnd(0, "failed", { failed_sub_step_index: null })]);
    expect(must(steps[0]).failedSubStep).toBeUndefined();
  });

  it("sorts steps by index however they arrive", () => {
    const { steps } = summarizeTestMdStream([stepStart(2), stepStart(0), stepStart(1)]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("ignores a step start that has no index", () => {
    expect(summarizeTestMdStream([ev("test_md_step_start", { heading: "Orphan" })]).steps).toEqual([]);
  });

  it("applies a step end without an index to the step that is currently open", () => {
    const { steps } = summarizeTestMdStream([stepStart(4, "Pay"), ev("test_md_step_end", { status: "failed" })]);
    expect(steps).toEqual([expect.objectContaining({ index: 4, status: "failed" })]);
  });

  it("reports the first failed step when several fail", () => {
    const { failedStep } = summarizeTestMdStream([
      stepStart(0),
      stepEnd(0, "passed"),
      stepStart(1),
      stepEnd(1, "failed"),
      stepStart(2),
      stepEnd(2, "failed"),
    ]);
    expect(failedStep?.index).toBe(1);
  });

  it("has no failed step when every step passed", () => {
    const summary = summarizeTestMdStream([stepStart(0), stepEnd(0, "passed"), ev("test_md_done", { overall_status: "passed" })]);
    expect(summary.status).toBe("passed");
    expect(summary.failedStep).toBeUndefined();
  });

  it("marks a step as replayed when its inner stream says replay_started", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), ev("step_event", { event: "replay_started" }), stepEnd(0, "passed")]);
    expect(must(steps[0]).replayed).toBe(true);
  });
});

describe("summarizeTestMdStream inner detail", () => {
  it("uses the summary of an inner step_end as the step's detail", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), innerStepEnd("failed", "No Total row"), stepEnd(0, "failed")]);
    expect(must(steps[0]).detail).toBe("No Total row");
  });

  it("falls back to the remark of an inner step_end", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), ev("step_end", { status: "failed", remark: "Button missing" })]);
    expect(must(steps[0]).detail).toBe("Button missing");
  });

  it("describes an inner run_end, adding its reason when that adds information", () => {
    const { steps } = summarizeTestMdStream([
      stepStart(0),
      runEnd("failed", { summary: "Total is wrong", reason: "Expected $23.00" }),
    ]);
    expect(must(steps[0]).detail).toBe("Total is wrong (Expected $23.00)");
  });

  it("uses the remark of an untyped progress event when nothing failed", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), progressEv(1, "running", "Clicking Pay")]);
    expect(must(steps[0]).detail).toBe("Clicking Pay");
  });

  it("lets a later failure explanation replace an earlier one", () => {
    const { steps } = summarizeTestMdStream([
      stepStart(0),
      innerStepEnd("failed", "first reason"),
      runEnd("failed", { summary: "final reason" }),
    ]);
    expect(must(steps[0]).detail).toBe("final reason");
  });

  it("never lets plain progress text overwrite a failure explanation", () => {
    const { steps } = summarizeTestMdStream([
      stepStart(0),
      innerStepEnd("failed", "No Total row"),
      progressEv(2, "running", "Retrying"),
      innerStepEnd("passed", "Retry clicked"),
    ]);
    expect(must(steps[0]).detail).toBe("No Total row");
  });

  it("lets a failure explanation replace earlier plain progress text", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), progressEv(1, "running", "Clicking Pay"), innerStepEnd("failed", "Pay did nothing")]);
    expect(must(steps[0]).detail).toBe("Pay did nothing");
  });

  it("keeps each step's detail separate", () => {
    const { steps } = summarizeTestMdStream([
      stepStart(0),
      innerStepEnd("failed", "step zero broke"),
      stepEnd(0, "failed"),
      stepStart(1),
      innerStepEnd("passed", "step one fine"),
      stepEnd(1, "passed"),
    ]);
    expect(steps.map((s) => s.detail)).toEqual(["step zero broke", "step one fine"]);
  });

  it("ignores inner events that arrive outside any open step", () => {
    const summary = summarizeTestMdStream([
      innerStepEnd("failed", "before any step"),
      stepStart(0),
      stepEnd(0, "passed"),
      innerStepEnd("failed", "after the step closed"),
    ]);
    expect(must(summary.steps[0]).detail).toBeUndefined();
  });

  it("ignores inner events that carry no text", () => {
    const { steps } = summarizeTestMdStream([stepStart(0), ev("step_end", { status: "failed" }), runEnd("failed")]);
    expect(must(steps[0]).detail).toBeUndefined();
  });
});

describe("summarizeTestMdStream totals, status and errors", () => {
  it("prefers test_md_done over test_md_summary for the final status", () => {
    const summary = summarizeTestMdStream([
      ev("test_md_summary", { overall_status: "passed" }),
      ev("test_md_done", { overall_status: "failed" }),
    ]);
    expect(summary.status).toBe("failed");
  });

  it("infers failed from a failing step when no overall status was reported", () => {
    const summary = summarizeTestMdStream([stepStart(0), stepEnd(0, "failed")]);
    expect(summary.status).toBe("failed");
  });

  it("stays unknown when nothing says how the run went", () => {
    expect(summarizeTestMdStream([stepStart(0), stepEnd(0, "passed")]).status).toBe("unknown");
  });

  it("ignores overall statuses other than passed and failed", () => {
    expect(summarizeTestMdStream([ev("test_md_done", { overall_status: "cancelled" })]).status).toBe("unknown");
  });

  it("leaves authored and replayed undefined when test_md_summary has no step counts", () => {
    const summary = summarizeTestMdStream([ev("test_md_summary", { overall_status: "passed" })]);
    expect(summary.authored).toBeUndefined();
    expect(summary.replayed).toBeUndefined();
  });

  it("collects error events instead of treating them as step detail", () => {
    const summary = summarizeTestMdStream([
      stepStart(0),
      ev("error", { code: "CHROME", message: "Chrome crashed", remedy: "restart Chrome" }),
      stepEnd(0, "failed"),
    ]);
    expect(summary.errors).toEqual([{ code: "CHROME", message: "Chrome crashed", remedy: "restart Chrome" }]);
    expect(must(summary.steps[0]).detail).toBeUndefined();
  });

  it("returns an empty unknown summary for no events", () => {
    expect(summarizeTestMdStream([])).toEqual({ status: "unknown", steps: [], errors: [], failedStep: undefined });
  });
});
