import { pendingProjects } from "../../judge/pending.js";
import { out } from "../../shared/logger.js";

const STDIN_WAIT_MS = 2_000;

/** The hook's JSON input from Claude Code; an empty object when nothing readable arrives in time. */
async function readHookInput(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, STDIN_WAIT_MS);
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await done;
  process.stdin.pause();
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function stopReason(pending: string[]): string {
  const where = pending.join(", ");
  return `Kane Judge: Kane's latest results for ${where} aren't in a scorecard yet. Close the loop before you stop: classify what failed, write verdict.json, and run \`kane-judge report\` on the project until it passes its evidence checks. If you can't finish now (you need the user, or Kane is unavailable), say exactly what is still open, and then stop.`;
}

/**
 * `kane-judge hook stop`: Claude Code's Stop hook. Blocks the stop once when
 * Kane's results are waiting to be turned into a checked scorecard. It never
 * blocks twice in a row, and any problem of its own lets the stop through.
 */
export async function stopHookCommand(): Promise<number> {
  try {
    if (process.env.KANE_JUDGE_NO_HOOK === "1") return 0;
    const input = await readHookInput();
    if (input.stop_hook_active === true) return 0;
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const pending = await pendingProjects(cwd);
    if (pending.length) out(JSON.stringify({ decision: "block", reason: stopReason(pending) }));
  } catch {
    // A hook must never trap a session: on any failure, let the stop happen.
  }
  return 0;
}
