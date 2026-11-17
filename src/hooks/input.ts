import { isAbsolute } from "node:path";

/** Fields every Claude Code hook receives on stdin. */
export interface CommonHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
}

export interface StopInput extends CommonHookInput {
  stop_hook_active: boolean;
}

export interface PreToolUseInput extends CommonHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Reads the hook's JSON payload from stdin (bounded in size and time). */
export function readStdin(timeoutMs = 15_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => reject(new Error("timed out reading hook input from stdin")), timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        clearTimeout(timer);
        reject(new Error("hook input is larger than 8 MB"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseObject(text: string): Parsed<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "hook input is not valid JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "hook input must be a JSON object" };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function common(raw: Record<string, unknown>): Parsed<CommonHookInput> {
  const { session_id, cwd, hook_event_name } = raw;
  if (typeof session_id !== "string" || session_id === "" || session_id.length > 200) {
    return { ok: false, error: "hook input has no valid session_id" };
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return { ok: false, error: "hook input has no absolute cwd" };
  if (typeof hook_event_name !== "string") return { ok: false, error: "hook input has no hook_event_name" };
  return { ok: true, value: { session_id, cwd, hook_event_name } };
}

export function parseStopInput(text: string): Parsed<StopInput> {
  const obj = parseObject(text);
  if (!obj.ok) return obj;
  const base = common(obj.value);
  if (!base.ok) return base;
  return { ok: true, value: { ...base.value, stop_hook_active: obj.value.stop_hook_active === true } };
}

export function parsePreToolUseInput(text: string): Parsed<PreToolUseInput> {
  const obj = parseObject(text);
  if (!obj.ok) return obj;
  const base = common(obj.value);
  if (!base.ok) return base;
  const { tool_name, tool_input } = obj.value;
  if (typeof tool_name !== "string") return { ok: false, error: "hook input has no tool_name" };
  const input = typeof tool_input === "object" && tool_input !== null && !Array.isArray(tool_input) ? tool_input : {};
  return { ok: true, value: { ...base.value, tool_name, tool_input: input as Record<string, unknown> } };
}

export function parseCommonInput(text: string): Parsed<CommonHookInput> {
  const obj = parseObject(text);
  return obj.ok ? common(obj.value) : obj;
}
