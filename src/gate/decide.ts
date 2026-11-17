import { createHash } from "node:crypto";
import type { KaneGateConfig } from "../config/schema.js";
import { formatBlockReason, formatInfraWarning, formatNeedsHuman, formatNudge, formatReceipt } from "./report.js";
import type { SessionRound } from "./state.js";
import type { Plan, Verification } from "./verify.js";

/** What the Stop hook should answer, plus the state changes that go with it. */
export interface HookDecision {
  action: "allow" | "block";
  /** Shown to Claude when blocking. */
  reason?: string;
  /** Shown to the user (systemMessage). */
  message?: string;
  /** Record the pre-run snapshot as the new green baseline. */
  markGreen?: boolean;
  round: SessionRound;
  /** Short label for logs and state. */
  label: string;
}

export function fingerprint(files: string[]): string {
  return createHash("sha1").update([...files].sort().join("\n")).digest("hex").slice(0, 16);
}

/** A new round starts whenever Claude stops on its own (not because a stop hook made it continue). */
export function startRound(prev: SessionRound | undefined, stopHookActive: boolean): SessionRound {
  const now = new Date().toISOString();
  if (!prev) return { attempts: 0, updatedAt: now };
  if (stopHookActive) return { ...prev, updatedAt: now };
  return { attempts: 0, gaveUp: false, nudged: prev.nudged, updatedAt: now };
}

function allow(round: SessionRound, label: string, message?: string): HookDecision {
  return { action: "allow", message, round: { ...round, lastOutcome: label }, label };
}

function list(files: string[], max = 6): string {
  return files.slice(0, max).join(", ") + (files.length > max ? ` and ${files.length - max} more` : "");
}

function nudgeOrNote(round: SessionRound, config: KaneGateConfig, uncovered: string[]): { block?: string; note?: string; nudged?: string } {
  if (uncovered.length === 0) return {};
  const fp = fingerprint(uncovered);
  if (config.coverageNudge && round.nudged !== fp) {
    return { block: formatNudge(uncovered, config.flowsDir, config.url), nudged: fp };
  }
  return { note: `Not covered by any Kane flow (not verified): ${list(uncovered)}.` };
}

/** Decision before anything runs. Returns "run" when Kane should verify the change. */
export function decideBeforeRun(round: SessionRound, config: KaneGateConfig, plan: Plan): HookDecision | "run" {
  if (round.gaveUp) return allow(round, "gave-up-earlier");
  switch (plan.kind) {
    case "no-changes":
      return allow(round, "no-changes");
    case "no-flows":
      return allow(round, "no-flows", `Kane Gate: app files changed but there are no *_test.md flows in ${config.flowsDir}, so nothing was verified. Run \`kane-gate init\` to add one.`);
    case "uncovered": {
      const n = nudgeOrNote(round, config, plan.uncovered);
      if (n.block) return { action: "block", reason: n.block, round: { ...round, nudged: n.nudged, lastOutcome: "nudge" }, label: "nudge" };
      return allow(round, "uncovered", `Kane Gate: ${n.note ?? "changes are not covered by any flow."}`);
    }
    case "run":
      return "run";
  }
}

function onFailure(round: SessionRound, config: KaneGateConfig, reason: string, giveUpMessage: string): HookDecision {
  if (round.attempts >= config.maxAttempts) {
    return { action: "allow", message: giveUpMessage, round: { ...round, gaveUp: true, lastOutcome: "gave-up" }, label: "gave-up" };
  }
  const next = { ...round, attempts: round.attempts + 1, lastOutcome: "fail" };
  return { action: "block", reason, round: next, label: "fail" };
}

function appStartFailureReason(status: Extract<Verification, { kind: "app-down" }>["status"], attempt: number, max: number): string {
  const logTail = "logTail" in status && status.logTail ? `\n\nDev server output (last lines):\n${status.logTail}` : "";
  return `Kane Gate: not done yet. The app did not start, so Kane could not test it (attempt ${attempt} of ${max}). ${status.reason}${logTail}\n\nNext: fix whatever stops the app from starting, then end your turn; Kane Gate restarts it and re-runs the flows.`;
}

/** Decision after a verification attempt. Kane errors and timeouts never block: they warn and let Claude stop. */
export function decideAfterRun(
  round: SessionRound,
  config: KaneGateConfig,
  plan: Extract<Plan, { kind: "run" }>,
  result: Verification,
  reportPath: string,
): HookDecision {
  if (result.kind === "busy") return allow(round, "busy", "Kane Gate: another verification is already running for this project; this stop was not verified.");
  if (result.kind === "app-down") {
    if (result.status.kind === "unreachable") return allow(round, "app-unreachable", formatInfraWarning(result.status.reason));
    const reason = appStartFailureReason(result.status, round.attempts + 1, config.maxAttempts);
    return onFailure(round, config, reason, formatNeedsHuman(undefined, round.attempts, reportPath));
  }
  const { outcome, view } = result;
  if (outcome.kind === "error") return allow(round, "kane-error", formatInfraWarning(outcome.reason, outcome.detail));
  if (outcome.kind === "timeout") return allow(round, "kane-timeout", formatInfraWarning(outcome.reason));
  if (outcome.kind === "failed") {
    const reason = view
      ? formatBlockReason(view, round.attempts + 1, config.maxAttempts, config.flowsDir)
      : `Kane Gate: not done yet. Kane reported failing flows (attempt ${round.attempts + 1} of ${config.maxAttempts}). Run \`kane-gate run\` to see the report.`;
    return onFailure(round, config, reason, formatNeedsHuman(view, round.attempts, reportPath));
  }
  const receipt = view ? formatReceipt(view) : "Kane Gate ✓ verified in a real browser.";
  const passed: SessionRound = { ...round, attempts: 0, gaveUp: false };
  const n = nudgeOrNote(passed, config, plan.uncovered);
  if (n.block) {
    const reason = `${receipt}\n\n${n.block}`;
    return { action: "block", reason, message: receipt, markGreen: true, round: { ...passed, nudged: n.nudged, lastOutcome: "pass+nudge" }, label: "pass+nudge" };
  }
  return { ...allow(passed, "pass", n.note ? `${receipt} ${n.note}` : receipt), markGreen: true };
}
