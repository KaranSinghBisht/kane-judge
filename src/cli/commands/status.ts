import { loadConfig } from "../../config/load.js";
import type { KaneGateConfig } from "../../config/schema.js";
import type { Flow } from "../../flows/discover.js";
import { globsFor, unknownMappings } from "../../flows/mapping.js";
import { loadState, type GateState } from "../../gate/state.js";
import { planVerification } from "../../gate/verify.js";
import { kaneStatus } from "../../kane/doctor.js";
import { out } from "../../shared/logger.js";

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

function flowLines(flows: Flow[], config: KaneGateConfig): string[] {
  if (flows.length === 0) return [`  (no *_test.md flows in ${config.flowsDir})`];
  const appHost = hostOf(config.url);
  return flows.map((f) => {
    const warn = f.url && hostOf(f.url) !== appHost ? `  ! url ${f.url} differs from config url` : "";
    return `  ${f.name.padEnd(18)} ${f.file}  covers: ${globsFor(f, config).join(", ")}${warn}`;
  });
}

function stateLines(state: GateState): string[] {
  const green = state.lastGreen;
  const lines = [green ? `Last green run: ${green.at} (${green.flows.join(", ")})` : "Last green run: none yet (committed code is the baseline)"];
  for (const [id, round] of Object.entries(state.sessions).slice(-3)) {
    lines.push(`Session ${id.slice(0, 8)}: ${round.attempts} failed attempt(s) this round, last outcome ${round.lastOutcome ?? "n/a"}${round.gaveUp ? ", gave up" : ""}`);
  }
  return lines;
}

/** `kane-gate status`: config, flows and their mappings, pending changes, gate state, Kane CLI health. */
export async function statusCommand(cwd: string): Promise<number> {
  const loaded = await loadConfig(cwd);
  if (loaded.kind === "absent") {
    out("Kane Gate is not set up here (no kane-gate.json). Run `kane-gate init`.");
    return 2;
  }
  if (loaded.kind === "invalid") {
    out(`kane-gate.json has problems:\n${loaded.errors.map((e) => `  - ${e}`).join("\n")}`);
    return 2;
  }
  const { projectDir, config } = loaded;
  const state = await loadState(projectDir);
  const planned = await planVerification({ projectDir, config, greenSnapshot: state.lastGreen?.snapshot, label: "status", runId: "status" });
  const kane = await kaneStatus(config.kaneBin, projectDir);
  const pending =
    planned.plan.kind === "run"
      ? `would run ${planned.plan.flows.map((f) => f.name).join(", ")} (${planned.plan.changes.unknown ? "changes unknown" : `${planned.plan.changes.files.length} changed file(s)`})`
      : planned.plan.kind;
  const lines = [
    `Project: ${projectDir}`,
    `App: ${config.url}${config.devCommand ? ` (devCommand: ${config.devCommand.join(" ")})` : ""}`,
    `Gate: maxAttempts ${config.maxAttempts} · lockFlows ${config.lockFlows} · coverageNudge ${config.coverageNudge} · headless ${config.headless} · parallel ${config.parallel} · timeout ${config.timeoutSec}s`,
    `Flows (${planned.allFlows.length}):`,
    ...flowLines(planned.allFlows, config),
    ...unknownMappings(planned.allFlows, config).map((n) => `  ! kane-gate.json maps "${n}" but no ${n}_test.md exists`),
    `Pending: ${pending}`,
    ...stateLines(state),
    `Kane CLI: ${kane.installed ? `${kane.version ?? "installed"}, ${kane.loggedIn === false ? "NOT signed in (kane-cli login)" : kane.loggedIn ? "signed in" : "sign-in unknown"}` : "NOT installed (npm install -g @testmuai/kane-cli)"}`,
  ];
  out(lines.join("\n"));
  return 0;
}
