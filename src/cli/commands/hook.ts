import { pendingWork, recordNudge } from "../../judge/pending.js";
import { out } from "../../shared/logger.js";

/** Files that hold Kane's record. Only `kane-judge scan` and `kane-judge run` write them; the agent reads them. */
const KANE_RECORD = /(?:^|[\\/])(?:kane-results\.json|scan\.json)$|[\\/]\.testmuai[\\/]|[\\/]\.kane-judge[\\/]/;

// The folder names must stand alone: "www.testmuai.com" in a URL is not Kane's `.testmuai` folder.
const RECORD_IN_COMMAND = /kane-results\.json|scan\.json|(?<![\w])\.testmuai(?![\w.-])|(?<![\w])\.kane-judge(?![\w.-])/;
/** Shell words that change files. A command that names Kane's record and uses one of them is stopped. */
const SHELL_WRITE = /(?:^|[\s;&|(])(?:rm|mv|cp|tee|truncate|dd|touch|ln|chmod|sponge|install|rsync|python3?|node|perl|ruby|awk|ed)\s|\bsed\s+(?:-[a-zA-Z]*i|--in-place)|>/;

/** Redirects that write no file: `2>&1`, `>&2`, `2>/dev/null`, `&>/dev/null`. Reading the record with one of these is still reading. */
const HARMLESS_REDIRECT = /\d*>&\d+|[&\d]*>\s*\/dev\/null(?![\w.\/-])/g;

/** The file a Write/Edit-style tool call is about to change, when it is part of Kane's record. */
function guardedFile(fields: Record<string, unknown>): string | undefined {
  const target = [fields.file_path, fields.notebook_path, fields.path].find((v): v is string => typeof v === "string" && v !== "");
  return target && KANE_RECORD.test(target) ? target : undefined;
}

/** What a shell command would change in Kane's record: set when it names the record and rewrites files. Reading is fine. */
function guardedCommand(fields: Record<string, unknown>): string | undefined {
  const command = typeof fields.command === "string" ? fields.command : "";
  const named = RECORD_IN_COMMAND.exec(command)?.[0];
  return named && SHELL_WRITE.test(command.replace(HARMLESS_REDIRECT, " ")) ? named : undefined;
}

/** The part of Kane's record a tool call is about to change, if any. */
export function guardedTarget(input: Record<string, unknown>): string | undefined {
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const fields = toolInput as Record<string, unknown>;
  return guardedFile(fields) ?? guardedCommand(fields);
}

/**
 * `kane-judge hook guard`: Claude Code's PreToolUse hook for the file-editing
 * tools and the shell. Kane's record (kane-results.json, scan.json, the sealed
 * packs) is written by the CLI from what Kane reported; an agent that edits it
 * could make a scorecard say anything. Exit 2 blocks the call and tells the
 * agent why. It keeps an agent honest; it is not a lock against a person with a shell.
 */
export async function guardHookCommand(): Promise<number> {
  try {
    if (process.env.KANE_JUDGE_NO_HOOK === "1") return 0;
    const target = guardedTarget(await readHookInput());
    if (!target) return 0;
    process.stderr.write(`Kane Judge: ${target} is Kane's record, written by \`kane-judge scan\` and \`kane-judge run\` from what Kane reported. Read it with the Read tool, but don't change it. To change what it says, change the flow or the product and run Kane again; your judgement goes in verdict.json.\n`);
    return 2;
  } catch {
    return 0;
  }
}

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
  return `Kane Judge: Kane's latest results for ${where} aren't in a scorecard yet. Close the loop before you stop: classify what failed, write verdict.json, and run \`kane-judge report\` on the project until it passes its evidence checks. If the user only asked for a run, or you can't finish now (you need the user, or Kane is unavailable), say exactly what is still open, and then stop. This reminder comes once per Kane run.`;
}

/**
 * `kane-judge hook stop`: Claude Code's Stop hook. Blocks the stop once when
 * Kane's results are waiting to be turned into a checked scorecard. It speaks
 * up once per Kane run (never twice about the same results), stays quiet after
 * a run Kane could not start, and any problem of its own lets the stop through.
 */
export async function stopHookCommand(): Promise<number> {
  try {
    if (process.env.KANE_JUDGE_NO_HOOK === "1") return 0;
    const input = await readHookInput();
    if (input.stop_hook_active === true) return 0;
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const pending = await pendingWork(cwd);
    if (pending.length === 0) return 0;
    await recordNudge(pending);
    out(JSON.stringify({ decision: "block", reason: stopReason(pending.map((p) => p.name)) }));
  } catch {
    // A hook must never trap a session: on any failure, let the stop happen.
  }
  return 0;
}
