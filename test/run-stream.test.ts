import { describe, expect, it } from "vitest";
import { parseNdjson } from "../src/kane/ndjson.js";
import { describeRunEnd, readProgress, readRunEnd, summarizeRunStream } from "../src/kane/run-stream.js";
import { ev, fixture, progressEv } from "./helpers/events.js";
import { must } from "./helpers/tmp.js";

describe("readProgress", () => {
  it("reads an untyped event that has a numeric step", () => {
    expect(readProgress(progressEv(2, "failed", "Button missing"))).toEqual({
      step: 2,
      status: "failed",
      remark: "Button missing",
    });
  });

  it("defaults the status to unknown", () => {
    expect(readProgress({ step: 1 })?.status).toBe("unknown");
  });

  it("ignores events that carry a type, even when they have a step field", () => {
    expect(readProgress({ type: "step_end", step: 1, status: "passed" })).toBeUndefined();
  });

  it("ignores events without a numeric step", () => {
    expect(readProgress({ status: "running" })).toBeUndefined();
    expect(readProgress({ step: "1", status: "running" })).toBeUndefined();
  });
});

describe("readRunEnd", () => {
  it("maps the run_end fields to camelCase", () => {
    const info = readRunEnd(
      ev("run_end", {
        status: "failed",
        summary: "S",
        one_liner: "O",
        reason: "R",
        duration: 3.5,
        credits: 2,
        final_state: { url: "http://x" },
        session_dir: "/tmp/s",
        test_url: "https://t",
      }),
    );
    expect(info).toEqual({
      status: "failed",
      summary: "S",
      oneLiner: "O",
      reason: "R",
      durationS: 3.5,
      credits: 2,
      finalState: { url: "http://x" },
      sessionDir: "/tmp/s",
      testUrl: "https://t",
    });
  });

  it("falls back to credits_consumed when credits is absent", () => {
    expect(readRunEnd(ev("run_end", { credits_consumed: 7 }))?.credits).toBe(7);
  });

  it("defaults the status to unknown", () => {
    expect(readRunEnd(ev("run_end"))?.status).toBe("unknown");
  });

  it("returns undefined for other event types", () => {
    expect(readRunEnd(ev("step_end", { status: "passed" }))).toBeUndefined();
  });
});

describe("summarizeRunStream", () => {
  it("summarizes a recorded failing run: failing step, run_end verdict and ordered steps", () => {
    const summary = summarizeRunStream(parseNdjson(fixture("run-agent.ndjson")).events);
    expect(summary.status).toBe("failed");
    expect(summary.steps.map((s) => s.step)).toEqual([1, 2]);
    expect(summary.failedStep).toMatchObject({ step: 2, remark: "Add to cart button not found" });
    expect(summary.runEnd).toMatchObject({ durationS: 14.2, credits: 1.5, testUrl: "https://example.test/t/1" });
  });

  it("keeps the latest status per step and carries the earlier remark forward", () => {
    const summary = summarizeRunStream([progressEv(1, "running", "Opening the page"), progressEv(1, "passed")]);
    expect(summary.steps).toEqual([{ step: 1, status: "passed", remark: "Opening the page" }]);
  });

  it("replaces an earlier remark when the later event brings a new one", () => {
    const summary = summarizeRunStream([progressEv(1, "running", "old"), progressEv(1, "failed", "new")]);
    expect(must(summary.steps[0]).remark).toBe("new");
  });

  it("sorts steps by number even when they arrive out of order", () => {
    const summary = summarizeRunStream([progressEv(3, "passed"), progressEv(1, "passed"), progressEv(2, "passed")]);
    expect(summary.steps.map((s) => s.step)).toEqual([1, 2, 3]);
  });

  it("reports passed when run_end says passed", () => {
    expect(summarizeRunStream([ev("run_end", { status: "passed" })]).status).toBe("passed");
  });

  it("reports unknown when the stream has no run_end", () => {
    const summary = summarizeRunStream([progressEv(1, "failed")]);
    expect(summary.status).toBe("unknown");
    expect(summary.failedStep?.step).toBe(1);
  });

  it("reports unknown for a run_end status it does not recognise", () => {
    expect(summarizeRunStream([ev("run_end", { status: "cancelled" })]).status).toBe("unknown");
  });

  it("lets the last run_end win", () => {
    const summary = summarizeRunStream([ev("run_end", { status: "failed" }), ev("run_end", { status: "passed" })]);
    expect(summary.status).toBe("passed");
  });

  it("returns an empty summary for an empty stream", () => {
    expect(summarizeRunStream([])).toEqual({ status: "unknown", steps: [], runEnd: undefined, failedStep: undefined });
  });
});

describe("describeRunEnd", () => {
  it("uses the summary when there is nothing to add", () => {
    expect(describeRunEnd({ status: "failed", summary: "No Total row" })).toBe("No Total row");
  });

  it("falls back to the one-liner when there is no summary", () => {
    expect(describeRunEnd({ status: "failed", oneLiner: "Cart step failed" })).toBe("Cart step failed");
  });

  it("appends the reason when it adds information", () => {
    expect(describeRunEnd({ status: "failed", summary: "No Total row", reason: "Expected a Total" })).toBe(
      "No Total row (Expected a Total)",
    );
  });

  it("does not repeat a reason the summary already contains", () => {
    expect(describeRunEnd({ status: "failed", summary: "Button missing on the page", reason: "Button missing" })).toBe(
      "Button missing on the page",
    );
  });

  it("never appends the generic success reason", () => {
    expect(describeRunEnd({ status: "passed", summary: "All good", reason: "Objective completed" })).toBe("All good");
  });

  it("uses the reason alone when it is all there is", () => {
    expect(describeRunEnd({ status: "failed", reason: "Timed out" })).toBe("Timed out");
  });

  it("returns undefined when the run_end says nothing", () => {
    expect(describeRunEnd({ status: "failed" })).toBeUndefined();
  });
});
