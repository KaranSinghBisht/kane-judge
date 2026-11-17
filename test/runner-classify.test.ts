import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Flow } from "../src/flows/discover.js";
import { classifyRun, type KaneOutcome, type KaneRunConfig } from "../src/kane/runner.js";
import type { MemberResult, TestrunSummary } from "../src/kane/testrun-stream.js";
import { makeConfig, makeFlow, makeMember, makeResult, makeSummary } from "./helpers/builders.js";
import { fixture } from "./helpers/events.js";
import { must, useTempDirs } from "./helpers/tmp.js";

const CHECKOUT = "kane/flows/checkout_test.md";
const FLOWS = [makeFlow("checkout"), makeFlow("promo")];
const makeDir = useTempDirs();

function opts(over: { flows?: Flow[]; config?: Partial<KaneRunConfig>; projectDir?: string } = {}) {
  return { config: makeConfig(over.config), flows: over.flows ?? FLOWS, projectDir: over.projectDir ?? "/work/app" };
}

function narrow<K extends KaneOutcome["kind"]>(outcome: KaneOutcome, kind: K): Extract<KaneOutcome, { kind: K }> {
  expect(outcome.kind).toBe(kind);
  return outcome as Extract<KaneOutcome, { kind: K }>;
}

function failedSummary(member: Partial<MemberResult> = {}): TestrunSummary {
  return makeSummary({
    status: "failed",
    members: [makeMember(CHECKOUT, "failed", { failure: { message: "step 1 failed", stepIndex: 1 }, ...member })],
  });
}

async function writeMemberLog(dir: string, content = fixture("testmd-failed.ndjson")): Promise<string> {
  const path = join(dir, "checkout.ndjson");
  await writeFile(path, content);
  return path;
}

describe("classifyRun: process-level problems", () => {
  it("reports a missing kane-cli with an install hint", async () => {
    const spawnError = Object.assign(new Error("spawn kane-cli ENOENT"), { code: "ENOENT" });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: null, spawnError }), makeSummary(), opts(), undefined), "error");
    expect(outcome.exitCode).toBeNull();
    expect(outcome.reason).toContain('"kane-cli" was not found on PATH');
    expect(outcome.reason).toContain("npm install -g @testmuai/kane-cli");
  });

  it("names the configured binary in the missing-binary message", async () => {
    const spawnError = Object.assign(new Error("spawn"), { code: "ENOENT" });
    const config = { kaneBin: "/opt/kane/bin/kane" };
    const outcome = narrow(await classifyRun(makeResult({ spawnError }), makeSummary(), opts({ config }), undefined), "error");
    expect(outcome.reason).toContain('"/opt/kane/bin/kane" was not found');
  });

  it("reports other spawn failures with the error code", async () => {
    const spawnError = Object.assign(new Error("spawn kane-cli EACCES"), { code: "EACCES", syscall: "spawn kane-cli" });
    const outcome = narrow(await classifyRun(makeResult({ spawnError }), makeSummary(), opts(), undefined), "error");
    expect(outcome.reason).toContain("could not start kane-cli");
    expect(outcome.reason).toContain("EACCES");
  });

  it("reports a timeout with the configured limit and keeps the evidence path", async () => {
    const result = makeResult({ timedOut: true, exitCode: null, signal: "SIGINT" });
    const outcome = narrow(await classifyRun(result, makeSummary(), opts({ config: { timeoutSec: 120 } }), "/ev/x.evidence"), "timeout");
    expect(outcome.reason).toBe("Kane did not finish within 120s and was stopped");
    expect(outcome.evidencePath).toBe("/ev/x.evidence");
  });

  it("treats a timed-out run as a timeout even when failures were already reported", async () => {
    const result = makeResult({ timedOut: true, exitCode: 1 });
    expect((await classifyRun(result, failedSummary(), opts(), undefined)).kind).toBe("timeout");
  });

  it("passes the process duration through on every outcome", async () => {
    const outcome = await classifyRun(makeResult({ exitCode: 3, durationMs: 4321 }), makeSummary(), opts(), undefined);
    expect(outcome.durationMs).toBe(4321);
  });
});

describe("classifyRun: exit codes", () => {
  it("passes when kane exits 0 and no member failed", async () => {
    const summary = makeSummary({ status: "passed", members: [makeMember(CHECKOUT, "passed")] });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 0 }), summary, opts(), "/ev/p.evidence"), "passed");
    expect(outcome.summary).toBe(summary);
    expect(outcome.evidencePath).toBe("/ev/p.evidence");
  });

  it("fails when kane exits 0 but a member failed", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 0 }), failedSummary(), opts(), undefined), "failed");
    expect(outcome.failures).toHaveLength(1);
  });

  it("fails when kane exits 1 with a failed member", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), failedSummary(), opts(), "/ev/f.evidence"), "failed");
    expect(outcome.evidencePath).toBe("/ev/f.evidence");
    expect(outcome.detail).toBeUndefined();
  });

  it("treats exit 3 as cancelled or timed out", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 3 }), makeSummary(), opts(), "/ev/t.evidence"), "timeout");
    expect(outcome.reason).toBe("Kane reported the run as cancelled or timed out (exit 3)");
    expect(outcome.evidencePath).toBe("/ev/t.evidence");
  });

  it("treats exit 2 as a setup or infrastructure error", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 2 }), makeSummary(), opts(), undefined), "error");
    expect(outcome.exitCode).toBe(2);
    expect(outcome.reason).toContain("exit 2: sign-in, setup or infrastructure problem");
  });

  it("treats exit 2 as an error even when members were reported failed", async () => {
    expect((await classifyRun(makeResult({ exitCode: 2 }), failedSummary(), opts(), undefined)).kind).toBe("error");
  });

  it("treats any other exit code as an unexpected end", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 137 }), makeSummary(), opts(), undefined), "error");
    expect(outcome.reason).toBe("kane-cli ended unexpectedly (exit 137)");
  });

  it("names the signal when the process was killed", async () => {
    const result = makeResult({ exitCode: null, signal: "SIGKILL" });
    const outcome = narrow(await classifyRun(result, makeSummary(), opts(), undefined), "error");
    expect(outcome.reason).toBe("kane-cli ended unexpectedly (exit signal SIGKILL)");
    expect(outcome.exitCode).toBeNull();
  });

  it("shows a question mark when neither an exit code nor a signal is known", async () => {
    const result = makeResult({ exitCode: null, signal: null });
    const outcome = narrow(await classifyRun(result, makeSummary(), opts(), undefined), "error");
    expect(outcome.reason).toBe("kane-cli ended unexpectedly (exit signal ?)");
  });
});

describe("classifyRun: failures with a member log", () => {
  it("reads the failing step and Kane's explanation from the member's own log", async () => {
    const logPath = await writeMemberLog(await makeDir());
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), failedSummary({ logPath }), opts(), undefined), "failed");
    const failure = must(outcome.failures[0]);
    expect(failure.step).toMatchObject({ index: 1, heading: "Apply the SAVE10 code", status: "failed" });
    expect(failure.step?.detail).toContain("The order summary shows no Total row");
    expect(failure.memberLog?.status).toBe("failed");
  });

  it("picks the step Kane named in the failure rather than the first failed one", async () => {
    const log = [
      '{"type":"test_md_step_start","step_index":0,"heading":"First"}',
      '{"type":"test_md_step_end","step_index":0,"status":"failed"}',
      '{"type":"test_md_step_start","step_index":1,"heading":"Second"}',
      '{"type":"test_md_step_end","step_index":1,"status":"failed"}',
    ].join("\n");
    const logPath = await writeMemberLog(await makeDir(), log);
    const summary = failedSummary({ logPath, failure: { message: "m", stepIndex: 1 } });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(must(outcome.failures[0]).step?.heading).toBe("Second");
  });

  it("falls back to the log's first failed step when the named step is not in the log", async () => {
    const logPath = await writeMemberLog(await makeDir());
    const summary = failedSummary({ logPath, failure: { message: "m", stepIndex: 99 } });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(must(outcome.failures[0]).step?.index).toBe(1);
  });

  it("still reports the failure when the member log cannot be read", async () => {
    const logPath = join(await makeDir(), "missing.ndjson");
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), failedSummary({ logPath }), opts(), undefined), "failed");
    const failure = must(outcome.failures[0]);
    expect(failure.member.path).toBe(CHECKOUT);
    expect(failure.step).toBeUndefined();
    expect(failure.memberLog).toBeUndefined();
  });

  it("still reports the failure when the member has no log path", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), failedSummary(), opts(), undefined), "failed");
    expect(must(outcome.failures[0]).step).toBeUndefined();
  });
});

describe("classifyRun: matching failures to flows", () => {
  it("matches a member to its flow by project-relative path", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), failedSummary(), opts(), undefined), "failed");
    expect(must(outcome.failures[0]).flow?.name).toBe("checkout");
  });

  it("matches a member reported with an absolute path", async () => {
    const summary = failedSummary({ path: `/work/app/${CHECKOUT}` });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(must(outcome.failures[0]).flow?.name).toBe("checkout");
  });

  it("matches by file name when Kane reports the path relative to another directory", async () => {
    const summary = failedSummary({ path: "../elsewhere/checkout_test.md" });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(must(outcome.failures[0]).flow?.name).toBe("checkout");
  });

  it("reports a failing member that matches no known flow", async () => {
    const summary = failedSummary({ path: "kane/flows/mystery_test.md" });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    const failure = must(outcome.failures[0]);
    expect(failure.flow).toBeUndefined();
    expect(failure.member.path).toBe("kane/flows/mystery_test.md");
  });
});

describe("classifyRun: Kane's own words when there is no per-flow detail", () => {
  const errorEvent = { code: "AUTH", message: "not signed in", remedy: "run kane-cli login" };

  it("describes error events as code, message and fix", async () => {
    const summary = makeSummary({ errors: [errorEvent] });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(outcome.failures).toEqual([]);
    expect(outcome.detail).toBe("AUTH: not signed in: fix: run kane-cli login");
  });

  it("omits missing parts of an error event", async () => {
    const summary = makeSummary({ errors: [{ message: "just a message" }] });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(outcome.detail).toBe("just a message");
  });

  it("lists the invalid files of a refused plan with Kane's reason", async () => {
    const plan = { valid: false, members: [{ path: "kane/flows/ok_test.md" }, { path: "kane/flows/bad_test.md", failure: "url is required" }] };
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), makeSummary({ plan }), opts(), undefined), "failed");
    expect(outcome.detail).toBe("kane/flows/bad_test.md: url is required");
  });

  it("puts error events before the invalid files", async () => {
    const plan = { valid: false, members: [{ path: "bad_test.md", failure: "no url" }] };
    const summary = makeSummary({ plan, errors: [errorEvent] });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(outcome.detail?.split("\n")).toEqual(["AUTH: not signed in: fix: run kane-cli login", "bad_test.md: no url"]);
  });

  it("falls back to the tail of stderr when stdout said nothing useful", async () => {
    const result = makeResult({ exitCode: 1, stderr: "\u001b[31mfatal: chrome not found\u001b[0m\n" });
    const outcome = narrow(await classifyRun(result, makeSummary(), opts(), undefined), "failed");
    expect(outcome.detail).toBe("fatal: chrome not found");
  });

  it("leaves the detail undefined when there is nothing at all to show", async () => {
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), makeSummary(), opts(), undefined), "failed");
    expect(outcome.detail).toBeUndefined();
  });

  it("redacts secrets in error events", async () => {
    const summary = makeSummary({ errors: [{ code: "AUTH", message: "bad access_key=AKIA999 supplied" }] });
    const outcome = narrow(await classifyRun(makeResult({ exitCode: 1 }), summary, opts(), undefined), "failed");
    expect(outcome.detail).not.toContain("AKIA999");
  });

  it("redacts secrets in the stderr tail of an infrastructure error", async () => {
    const result = makeResult({ exitCode: 2, stderr: "auth rejected: Bearer topsecret.token\n" });
    const outcome = narrow(await classifyRun(result, makeSummary(), opts(), undefined), "error");
    expect(outcome.detail).toBe("auth rejected: Bearer [redacted]");
  });

  it("gives an infrastructure error the error events as detail", async () => {
    const result = makeResult({ exitCode: 2, stderr: "ignored when events exist" });
    const outcome = narrow(await classifyRun(result, makeSummary({ errors: [errorEvent] }), opts(), undefined), "error");
    expect(outcome.detail).toBe("AUTH: not signed in: fix: run kane-cli login");
  });
});
