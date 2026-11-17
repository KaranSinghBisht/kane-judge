import { join } from "node:path";
import { loadConfig } from "../../config/load.js";
import { formatInfraWarning, formatTerminal } from "../../gate/report.js";
import { loadState, saveState, stateDir } from "../../gate/state.js";
import { planVerification, runPlannedFlows, type Plan, type Verification } from "../../gate/verify.js";
import { REPORT_FILE, runIdFor } from "../../hooks/stop.js";
import { eventType, num, str, type KaneEvent } from "../../kane/ndjson.js";
import { writeTextAtomic } from "../../shared/fs.js";
import { configureLogger, out } from "../../shared/logger.js";

export interface RunArgs {
  cwd: string;
  all: boolean;
  flows: string[];
  json: boolean;
}

function progress(event: KaneEvent): void {
  const type = eventType(event);
  const name = (str(event, "path") ?? "").split(/[\\/]/).pop()?.replace(/_test\.md$/, "");
  if (type === "testrun_member_start" || type === "testrun_authored_member_start") {
    process.stderr.write(`  ▶ ${name}${type.includes("authored") ? " (first run: Kane is authoring it)" : ""}\n`);
  } else if (type === "testrun_member_end" || type === "testrun_authored_member_end") {
    const ok = str(event, "status") === "passed";
    const secs = num(event, "duration_s");
    process.stderr.write(`  ${ok ? "✓" : "✗"} ${name}${secs !== undefined ? ` (${Math.round(secs)}s)` : ""}\n`);
  }
}

function describePlan(plan: Exclude<Plan, { kind: "run" }>, flowsDir: string): string {
  if (plan.kind === "no-changes") return "Nothing to verify: no app changes since the last green run. Use --all to run every flow anyway.";
  if (plan.kind === "no-flows") return `No flows found in ${flowsDir}. Add a *_test.md flow (kane-gate init creates an example).`;
  return `Changed files are not covered by any flow: ${plan.uncovered.join(", ")}.\nAdd a flow in ${flowsDir} or map one to these paths in kane-gate.json, or use --all.`;
}

function report(result: Verification): { text: string; code: number } {
  if (result.kind === "busy") return { text: "Another Kane Gate verification is running for this project.", code: 2 };
  if (result.kind === "app-down") {
    const tail = "logTail" in result.status && result.status.logTail ? `\n\n${result.status.logTail}` : "";
    return { text: `${result.status.reason}${tail}`, code: result.status.kind === "unreachable" ? 2 : 1 };
  }
  const { outcome, view } = result;
  if (outcome.kind === "error") return { text: formatInfraWarning(outcome.reason, outcome.detail), code: 2 };
  if (outcome.kind === "timeout") return { text: formatInfraWarning(outcome.reason), code: 2 };
  const text = view ? formatTerminal(view) : outcome.kind.toUpperCase();
  return { text, code: outcome.kind === "passed" ? 0 : 1 };
}

/** `kane-gate run`: the same verification the Stop hook performs, on demand. */
export async function runVerifyCommand(args: RunArgs): Promise<number> {
  const loaded = await loadConfig(args.cwd);
  if (loaded.kind === "absent") {
    out("No kane-gate.json found here or in a parent directory. Run `kane-gate init` first.");
    return 2;
  }
  if (loaded.kind === "invalid") {
    out(`kane-gate.json has problems:\n${loaded.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 2;
  }
  const { projectDir, config } = loaded;
  configureLogger({ file: join(stateDir(projectDir), "kane-gate.log"), stderr: false });
  const state = await loadState(projectDir);
  const runId = runIdFor("manual");
  const opts = { projectDir, config, greenSnapshot: state.lastGreen?.snapshot, all: args.all, only: args.flows, label: `kane-gate-${runId}`, runId, onEvent: progress };
  const planned = await planVerification(opts);
  if (planned.plan.kind !== "run") {
    out(args.json ? JSON.stringify({ plan: planned.plan.kind }) : describePlan(planned.plan, config.flowsDir));
    return 0;
  }
  const flows = planned.plan.flows;
  process.stderr.write(`Kane Gate: running ${flows.length} flow(s) in a real browser: ${flows.map((f) => f.name).join(", ")}\n`);
  const result = await runPlannedFlows(opts, flows);
  const { text, code } = report(result);
  if (code === 0 && planned.snapshot) {
    state.lastGreen = { at: new Date().toISOString(), snapshot: planned.snapshot, flows: flows.map((f) => f.name) };
    await saveState(projectDir, state);
  }
  await writeTextAtomic(join(projectDir, REPORT_FILE), `# Kane Gate report\n\n\`\`\`text\n${text}\n\`\`\`\n`);
  out(args.json ? JSON.stringify({ plan: "run", result: result.kind === "ran" ? result.outcome.kind : result.kind, view: result.kind === "ran" ? result.view : undefined }, null, 2) : text);
  return code;
}
