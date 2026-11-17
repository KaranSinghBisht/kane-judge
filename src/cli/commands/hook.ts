import { handleGuard, handleSessionEnd, handleSessionStart } from "../../hooks/handlers.js";
import { parseCommonInput, parsePreToolUseInput, parseStopInput, readStdin } from "../../hooks/input.js";
import { messageOutput, type HookOutput } from "../../hooks/output.js";
import { handleStop } from "../../hooks/stop.js";
import { safeMessage } from "../../shared/errors.js";
import { log, out } from "../../shared/logger.js";

export const HOOK_EVENTS = ["stop", "guard", "session-start", "session-end"] as const;
type HookEvent = (typeof HOOK_EVENTS)[number];

async function dispatch(event: HookEvent, text: string): Promise<HookOutput> {
  switch (event) {
    case "stop": {
      const input = parseStopInput(text);
      if (!input.ok) throw new Error(input.error);
      return handleStop(input.value);
    }
    case "guard": {
      const input = parsePreToolUseInput(text);
      if (!input.ok) throw new Error(input.error);
      return handleGuard(input.value);
    }
    case "session-start":
    case "session-end": {
      const input = parseCommonInput(text);
      if (!input.ok) throw new Error(input.error);
      return event === "session-start" ? handleSessionStart(input.value) : handleSessionEnd(input.value);
    }
  }
}

/**
 * Hook entry point. Always exits 0 and prints at most one JSON object, so a
 * Kane Gate bug can never wedge Claude: on an internal error the Stop hook lets
 * Claude stop and says why; the other hooks stay silent.
 */
export async function hookCommand(event: string | undefined): Promise<number> {
  if (!event || !(HOOK_EVENTS as readonly string[]).includes(event)) {
    log.error(`unknown hook "${event ?? ""}" (expected one of: ${HOOK_EVENTS.join(", ")})`);
    return 0;
  }
  let output: HookOutput;
  try {
    output = await dispatch(event as HookEvent, await readStdin());
  } catch (err) {
    log.error(`${event} hook failed: ${safeMessage(err)}`);
    output = event === "stop" ? messageOutput(`Kane Gate hit an internal error and did not verify this stop: ${safeMessage(err)}`) : undefined;
  }
  if (output) out(JSON.stringify(output));
  return 0;
}
