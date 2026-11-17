import { isAbsolute, resolve } from "node:path";
import { CONFIG_FILE, STATE_DIR, type KaneGateConfig } from "../config/schema.js";
import { relativeInside } from "../shared/fs.js";
import type { PreToolUseInput } from "./input.js";

export interface GuardContext {
  projectDir: string;
  config: KaneGateConfig;
  /** Whether an absolute path exists on disk (injected for tests). */
  exists: (absPath: string) => boolean;
}

export interface GuardDenial {
  reason: string;
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** `> file` / `>> file` redirection targets in a shell command. */
const REDIRECT_TARGET = /\d?>{1,2}\|?\s*([^\s;|&<>()]+)/g;
const MUTATING_VERB =
  /(\bsed\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|\b(rm|mv|cp|tee|truncate|ln|chmod|unlink|dd|install|touch)\b|\bgit\s+(checkout|restore|rm|mv|stash|reset|apply)\b)/;

function lockedReason(what: string, flowsDir: string): string {
  return (
    `Kane Gate: ${what} is locked. The flows in ${flowsDir} are the acceptance tests that Kane runs in a real ` +
    "browser, so the agent can't edit them to make a check pass. Fix the application instead. If a flow is genuinely " +
    "wrong, explain why in your reply and leave the change to a human (a human can set \"lockFlows\": false in kane-gate.json)."
  );
}

function filePathOf(input: PreToolUseInput): string | undefined {
  const t = input.tool_input;
  const value = t.file_path ?? t.notebook_path ?? t.path;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function guardFile(input: PreToolUseInput, ctx: GuardContext): GuardDenial | undefined {
  const target = filePathOf(input);
  if (!target) return undefined;
  const abs = isAbsolute(target) ? target : resolve(input.cwd, target);
  const rel = relativeInside(ctx.projectDir, abs);
  if (rel === undefined || rel === "") return undefined;
  const { flowsDir } = ctx.config;
  if (rel === CONFIG_FILE) return { reason: lockedReason(CONFIG_FILE, flowsDir) };
  if (rel === STATE_DIR || rel.startsWith(`${STATE_DIR}/`)) return { reason: lockedReason("Kane Gate's state (.kane-gate/)", flowsDir) };
  if (!rel.startsWith(`${flowsDir}/`)) return undefined;
  const isNewFlow =
    input.tool_name === "Write" && rel.endsWith("_test.md") && !/\/(helper-)?output-/.test(rel) && !ctx.exists(abs);
  if (isNewFlow) return undefined;
  return { reason: lockedReason(rel, flowsDir) };
}

function redirectsInto(command: string, tokens: string[]): boolean {
  for (const match of command.matchAll(REDIRECT_TARGET)) {
    const target = match[1] ?? "";
    if (target.startsWith("&") || target === "/dev/null") continue;
    if (tokens.some((t) => target.includes(t))) return true;
  }
  return false;
}

function guardBash(input: PreToolUseInput, ctx: GuardContext): GuardDenial | undefined {
  const command = input.tool_input.command;
  if (typeof command !== "string") return undefined;
  const tokens = [ctx.config.flowsDir, CONFIG_FILE, STATE_DIR, "_test.md"];
  const mentioned = tokens.find((t) => command.includes(t));
  if (!mentioned) return undefined;
  if (!redirectsInto(command, tokens) && !MUTATING_VERB.test(command)) return undefined;
  return {
    reason: `${lockedReason(`${mentioned} (via a shell command)`, ctx.config.flowsDir)} Read-only commands such as cat, grep and kane-cli are fine; to add a new flow, use the Write tool.`,
  };
}

/** Decides whether a tool call would modify Kane Gate's protected files. Returns a denial or undefined. */
export function decideGuard(input: PreToolUseInput, ctx: GuardContext): GuardDenial | undefined {
  if (!ctx.config.lockFlows) return undefined;
  if (FILE_TOOLS.has(input.tool_name)) return guardFile(input, ctx);
  if (input.tool_name === "Bash") return guardBash(input, ctx);
  return undefined;
}
