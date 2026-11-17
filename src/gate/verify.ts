import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { diffSnapshots, takeSnapshot } from "../changes/snapshot.js";
import type { ChangeSet, Snapshot } from "../changes/types.js";
import { BUILTIN_IGNORES, type KaneGateConfig } from "../config/schema.js";
import { ensureApp, type AppStatus } from "../devserver/ensure.js";
import { locatePack, readFailureEvidence, type StepEvidence } from "../evidence/pack.js";
import { discoverFlows, type Flow } from "../flows/discover.js";
import { ignoreMatcher, selectFlows } from "../flows/mapping.js";
import type { KaneEvent } from "../kane/ndjson.js";
import { runKane, type FlowFailure, type KaneOutcome } from "../kane/runner.js";
import { safeMessage } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { acquireLock, stateDir } from "./state.js";
import { buildRunView, type RunView } from "./view.js";

export interface VerifyOptions {
  projectDir: string;
  config: KaneGateConfig;
  /** Snapshot of the last green run; changes are measured against it. */
  greenSnapshot?: Snapshot;
  /** Run every flow, ignoring change detection. */
  all?: boolean;
  /** Run only these flows (by name). */
  only?: string[];
  /** Run title label in Test Manager. */
  label: string;
  /** Directory name for this run's artifacts under .kane-gate/artifacts/. */
  runId: string;
  onEvent?: (event: KaneEvent) => void;
}

export type Plan =
  | { kind: "no-changes"; changes: ChangeSet }
  | { kind: "no-flows"; changes: ChangeSet }
  | { kind: "uncovered"; changes: ChangeSet; uncovered: string[] }
  | { kind: "run"; changes: ChangeSet; flows: Flow[]; uncovered: string[] };

export interface Planned {
  plan: Plan;
  allFlows: Flow[];
  /** State of the project before the run; becomes the new green baseline when the run passes. */
  snapshot?: Snapshot;
}

export type Verification =
  | { kind: "app-down"; status: Extract<AppStatus, { ok: false }> }
  | { kind: "busy" }
  | { kind: "ran"; outcome: KaneOutcome; view?: RunView };

const FORCED: ChangeSet = { files: [], unknown: true, baseline: "none" };

/** Decides which flows to run: only those whose mappings match what changed since the last green run. */
export async function planVerification(opts: VerifyOptions): Promise<Planned> {
  const { projectDir, config } = opts;
  const isIgnored = ignoreMatcher([...BUILTIN_IGNORES, ...config.ignore]);
  const allFlows = await discoverFlows(projectDir, config.flowsDir);
  const snapshot = await takeSnapshot(projectDir, isIgnored);
  if (opts.all || (opts.only && opts.only.length > 0)) {
    const wanted = opts.only && opts.only.length > 0 ? allFlows.filter((f) => opts.only?.includes(f.name)) : allFlows;
    const plan: Plan = wanted.length ? { kind: "run", changes: FORCED, flows: wanted, uncovered: [] } : { kind: "no-flows", changes: FORCED };
    return { plan, allFlows, snapshot };
  }
  const changes = await diffSnapshots(projectDir, opts.greenSnapshot, snapshot, isIgnored);
  if (!changes.unknown && changes.files.length === 0) return { plan: { kind: "no-changes", changes }, allFlows, snapshot };
  if (allFlows.length === 0) return { plan: { kind: "no-flows", changes }, allFlows, snapshot };
  const selection = selectFlows(allFlows, config, changes.files, changes.unknown);
  if (selection.affected.length === 0) {
    return { plan: { kind: "uncovered", changes, uncovered: selection.uncovered }, allFlows, snapshot };
  }
  return { plan: { kind: "run", changes, flows: selection.affected, uncovered: selection.uncovered }, allFlows, snapshot };
}

function artifactName(failure: FlowFailure): string {
  const name = (failure.flow?.name ?? failure.member.path).replace(/[^A-Za-z0-9_-]+/g, "-");
  const step = failure.step?.index ?? failure.member.failure?.stepIndex;
  return `${name}${step !== undefined ? `-step-${step}` : ""}.png`;
}

async function gatherEvidence(
  opts: VerifyOptions,
  outcome: Extract<KaneOutcome, { kind: "failed" }>,
): Promise<Map<string, StepEvidence>> {
  const evidence = new Map<string, StepEvidence>();
  if (!outcome.evidencePath) return evidence;
  for (const failure of outcome.failures) {
    const flowText = failure.flow
      ? await readFile(join(opts.projectDir, failure.flow.file), "utf8").catch(() => undefined)
      : undefined;
    const screenshotTo = join(stateDir(opts.projectDir), "artifacts", opts.runId, artifactName(failure));
    const ev = await readFailureEvidence(outcome.evidencePath, { testId: failure.member.testId, flowText, screenshotTo });
    if (ev) evidence.set(failure.member.path, ev);
  }
  return evidence;
}

async function finishOutcome(opts: VerifyOptions, flows: Flow[], outcome: KaneOutcome, startedMs: number): Promise<Verification> {
  if (outcome.kind !== "passed" && outcome.kind !== "failed") return { kind: "ran", outcome };
  outcome.evidencePath ??= await locatePack(opts.projectDir, {
    executionId: outcome.summary.executionId,
    sinceMs: startedMs - 5_000,
  });
  let evidence = new Map<string, StepEvidence>();
  if (outcome.kind === "failed") {
    try {
      evidence = await gatherEvidence(opts, outcome);
    } catch (err) {
      log.warn(`could not read the evidence pack: ${safeMessage(err)}`);
    }
  }
  return { kind: "ran", outcome, view: buildRunView(outcome, flows, evidence, opts.projectDir) };
}

/** Starts the app if needed, runs the planned flows with Kane, and reads the evidence of any failure. */
export async function runPlannedFlows(opts: VerifyOptions, flows: Flow[]): Promise<Verification> {
  const release = await acquireLock(opts.projectDir, (opts.config.timeoutSec + 180) * 1000);
  if (!release) return { kind: "busy" };
  try {
    const app = await ensureApp(opts.projectDir, opts.config);
    if (!app.ok) return { kind: "app-down", status: app };
    const startedMs = Date.now();
    const outcome = await runKane({
      projectDir: opts.projectDir,
      config: opts.config,
      flows,
      label: opts.label,
      onEvent: opts.onEvent,
    });
    return await finishOutcome(opts, flows, outcome, startedMs);
  } finally {
    await release();
  }
}
