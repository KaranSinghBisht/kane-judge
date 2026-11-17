import type { HookDecision } from "../gate/decide.js";

/** JSON printed on stdout for Claude Code. `undefined` means "print nothing" (allow, silently). */
export type HookOutput = Record<string, unknown> | undefined;

/** Stop hook output: `decision: "block"` keeps Claude working; `systemMessage` informs the user. */
export function stopOutput(decision: HookDecision): HookOutput {
  if (decision.action === "block") {
    return {
      decision: "block",
      reason: decision.reason ?? "Kane Gate: verification failed.",
      ...(decision.message ? { systemMessage: decision.message } : {}),
    };
  }
  return decision.message ? { systemMessage: decision.message } : undefined;
}

export function denyToolOutput(reason: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function contextOutput(event: "SessionStart", additionalContext: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

export function messageOutput(systemMessage: string): HookOutput {
  return { systemMessage };
}
