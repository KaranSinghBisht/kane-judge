import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/load.js";
import type { KaneGateConfig } from "../config/schema.js";
import { decideAfterRun, decideBeforeRun, startRound, type HookDecision } from "../gate/decide.js";
import { formatTerminal } from "../gate/report.js";
import { loadState, saveState, stateDir, type GateState } from "../gate/state.js";
import { planVerification, runPlannedFlows, type Planned, type Verification } from "../gate/verify.js";
import { writeTextAtomic } from "../shared/fs.js";
import { configureLogger, log } from "../shared/logger.js";
import type { StopInput } from "./input.js";
import { messageOutput, stopOutput, type HookOutput } from "./output.js";

export const REPORT_FILE = ".kane-gate/last-report.md";

export function runIdFor(sessionId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${sessionId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`;
}

async function writeReport(projectDir: string, decision: HookDecision, result: Verification): Promise<void> {
  const body =
    result.kind === "ran" && result.view
      ? formatTerminal(result.view)
      : decision.reason ?? decision.message ?? decision.label;
  const text = `# Kane Gate report\n\n${new Date().toISOString()} · outcome: ${decision.label}\n\n\`\`\`text\n${body}\n\`\`\`\n`;
  await writeTextAtomic(join(projectDir, REPORT_FILE), text);
}

async function appendHistory(projectDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(join(stateDir(projectDir), "history.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

function recordGreen(state: GateState, planned: Planned, result: Verification): void {
  if (!planned.snapshot || planned.plan.kind !== "run") return;
  const evidencePath = result.kind === "ran" && result.outcome.kind === "passed" ? result.outcome.evidencePath : undefined;
  state.lastGreen = {
    at: new Date().toISOString(),
    snapshot: planned.snapshot,
    flows: planned.plan.flows.map((f) => f.name),
    evidencePath,
  };
}

async function verifyAndDecide(
  input: StopInput,
  projectDir: string,
  config: KaneGateConfig,
  state: GateState,
): Promise<HookDecision> {
  const round = startRound(state.sessions[input.session_id], input.stop_hook_active);
  const runId = runIdFor(input.session_id);
  const opts = {
    projectDir,
    config,
    greenSnapshot: state.lastGreen?.snapshot,
    label: `kane-gate-${runId}`,
    runId,
  };
  const planned = await planVerification(opts);
  const before = decideBeforeRun(round, config, planned.plan);
  if (before !== "run") return before;
  const plan = planned.plan;
  if (plan.kind !== "run") return { action: "allow", round, label: "no-plan" };
  const flowNames = plan.flows.map((f) => f.name);
  log.info(`verifying ${flowNames.join(", ")} (changed: ${plan.changes.files.length} files)`);
  const result = await runPlannedFlows(opts, plan.flows);
  const decision = decideAfterRun(round, config, plan, result, REPORT_FILE);
  if (decision.markGreen) recordGreen(state, planned, result);
  await writeReport(projectDir, decision, result);
  await appendHistory(projectDir, { at: new Date().toISOString(), session: input.session_id, runId, outcome: decision.label, flows: flowNames });
  return decision;
}

/** Stop hook: lets Claude finish only when the affected Kane flows pass (or when the gate must step aside). */
export async function handleStop(input: StopInput): Promise<HookOutput> {
  const loaded = await loadConfig(input.cwd, process.env.CLAUDE_PROJECT_DIR);
  if (loaded.kind === "absent") return undefined;
  if (loaded.kind === "invalid") {
    return messageOutput(`Kane Gate is off: kane-gate.json has problems: ${loaded.errors.join("; ")}`);
  }
  const { projectDir, config } = loaded;
  configureLogger({ file: join(stateDir(projectDir), "kane-gate.log"), stderr: false });
  const state = await loadState(projectDir);
  const decision = await verifyAndDecide(input, projectDir, config, state);
  state.sessions[input.session_id] = decision.round;
  await saveState(projectDir, state);
  log.info(`stop decision: ${decision.action} (${decision.label})`);
  return stopOutput(decision);
}
