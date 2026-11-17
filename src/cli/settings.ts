import { readJsonFile, writeJsonAtomic } from "../shared/fs.js";
import { KaneGateError } from "../shared/errors.js";

interface HookHandler {
  type: string;
  command?: string;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

type HooksConfig = Record<string, MatcherGroup[]>;

/** Shell-form command (path quoted) that runs one Kane Gate hook through node. */
export function hookCommandFor(scriptPath: string, event: string): string {
  return `node "${scriptPath.replace(/"/g, '\\"')}" hook ${event}`;
}

/** The hook wiring Kane Gate needs, for settings.json users (plugin users get hooks/hooks.json instead). */
export function kaneGateHooks(scriptPath: string): HooksConfig {
  return {
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: hookCommandFor(scriptPath, "stop"),
            timeout: 1800,
            statusMessage: "Kane Gate: verifying in a real browser…",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
        hooks: [{ type: "command", command: hookCommandFor(scriptPath, "guard"), timeout: 15 }],
      },
    ],
    SessionStart: [{ hooks: [{ type: "command", command: hookCommandFor(scriptPath, "session-start"), timeout: 15 }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: hookCommandFor(scriptPath, "session-end"), timeout: 5 }] }],
  };
}

const isOurs = (h: HookHandler) => typeof h.command === "string" && /kane-gate(\.mjs)?"? hook /.test(h.command);

/** Removes earlier Kane Gate handlers so re-running init never duplicates hooks. */
function withoutKaneGate(groups: MatcherGroup[]): MatcherGroup[] {
  return groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
}

/** Merges Kane Gate hooks into a settings object, preserving every other setting and hook. */
export function mergeHooks(settings: Record<string, unknown>, ours: HooksConfig): Record<string, unknown> {
  const existing = (settings.hooks ?? {}) as HooksConfig;
  if (typeof existing !== "object" || Array.isArray(existing)) {
    throw new KaneGateError('"hooks" in the Claude Code settings file is not an object; fix it by hand first', "BAD_SETTINGS");
  }
  const merged: HooksConfig = {};
  for (const [event, groups] of Object.entries(existing)) {
    const kept = Array.isArray(groups) ? withoutKaneGate(groups) : [];
    if (kept.length > 0) merged[event] = kept;
  }
  for (const [event, groups] of Object.entries(ours)) merged[event] = [...(merged[event] ?? []), ...groups];
  return { ...settings, hooks: merged };
}

/** Reads, merges and writes a Claude Code settings file. */
export async function installHooks(settingsPath: string, scriptPath: string): Promise<void> {
  const current = (await readJsonFile(settingsPath)) ?? {};
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new KaneGateError(`${settingsPath} does not contain a JSON object`, "BAD_SETTINGS");
  }
  await writeJsonAtomic(settingsPath, mergeHooks(current as Record<string, unknown>, kaneGateHooks(scriptPath)));
}
