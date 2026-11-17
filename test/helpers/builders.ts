import type { Flow } from "../../src/flows/discover.js";
import { DEFAULT_RUN_CONFIG, type KaneRunConfig } from "../../src/kane/runner.js";
import type { MemberResult, TestrunSummary } from "../../src/kane/testrun-stream.js";
import type { RunResult } from "../../src/shared/proc.js";

/** The default Kane run settings, with overrides. */
export function makeConfig(overrides: Partial<KaneRunConfig> = {}): KaneRunConfig {
  return { ...DEFAULT_RUN_CONFIG, ...overrides };
}

export function makeFlow(name: string, overrides: Partial<Flow> = {}): Flow {
  return { name, file: `kane/flows/${name}_test.md`, tags: [], ...overrides };
}

export function makeMember(path: string, status: string, overrides: Partial<MemberResult> = {}): MemberResult {
  return { path, status, authored: false, ...overrides };
}

export function makeSummary(overrides: Partial<TestrunSummary> = {}): TestrunSummary {
  return { status: "unknown", members: [], errors: [], warnings: [], ...overrides };
}

/** A finished child process, as runCommand reports it. */
export function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 1234, ...overrides };
}
