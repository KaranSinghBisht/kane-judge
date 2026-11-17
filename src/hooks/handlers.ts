import { existsSync } from "node:fs";
import { loadConfig } from "../config/load.js";
import { stopDevServer } from "../devserver/ensure.js";
import { discoverFlows } from "../flows/discover.js";
import { decideGuard } from "./guard.js";
import type { CommonHookInput, PreToolUseInput } from "./input.js";
import { contextOutput, denyToolOutput, type HookOutput } from "./output.js";

/** PreToolUse: deny agent edits to locked flows, kane-gate.json and .kane-gate/. */
export async function handleGuard(input: PreToolUseInput): Promise<HookOutput> {
  const loaded = await loadConfig(input.cwd, process.env.CLAUDE_PROJECT_DIR);
  if (loaded.kind !== "ok") return undefined;
  const denial = decideGuard(input, { projectDir: loaded.projectDir, config: loaded.config, exists: existsSync });
  return denial ? denyToolOutput(denial.reason) : undefined;
}

/** SessionStart: tell Claude, as plain facts, that this project is gated and how. */
export async function handleSessionStart(input: CommonHookInput): Promise<HookOutput> {
  const loaded = await loadConfig(input.cwd, process.env.CLAUDE_PROJECT_DIR);
  if (loaded.kind !== "ok") return undefined;
  const { config, projectDir } = loaded;
  const flows = await discoverFlows(projectDir, config.flowsDir);
  const names = flows.map((f) => f.name).join(", ") || "none yet";
  const text = [
    `Kane Gate is active in this project. When Claude ends a turn after changing app files, Kane CLI runs the affected browser flows from ${config.flowsDir} (${names}) against ${config.url} in a real Chrome browser.`,
    "If a flow fails, the stop is blocked and Kane's report (failing step, browser console errors, failed network calls, a screenshot path) comes back as the reason.",
    config.lockFlows
      ? `The flow files (${config.flowsDir}/*_test.md, plain English) are the acceptance tests and are locked: fixes belong in the app code. New flow files may be added.`
      : `The flow files are ${config.flowsDir}/*_test.md (plain English).`,
    "The same check runs on demand with the `kane-gate run` command.",
  ].join(" ");
  return contextOutput("SessionStart", text);
}

/** SessionEnd: stop the dev server Kane Gate started, if any. */
export async function handleSessionEnd(input: CommonHookInput): Promise<HookOutput> {
  const loaded = await loadConfig(input.cwd, process.env.CLAUDE_PROJECT_DIR);
  if (loaded.kind === "ok") await stopDevServer(loaded.projectDir);
  return undefined;
}
