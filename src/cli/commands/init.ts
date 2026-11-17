import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE, DEFAULTS, STATE_DIR } from "../../config/schema.js";
import { validateConfig } from "../../config/validate.js";
import { discoverFlows } from "../../flows/discover.js";
import { kaneStatus } from "../../kane/doctor.js";
import { pathExists, writeJsonAtomic } from "../../shared/fs.js";
import { out } from "../../shared/logger.js";
import { installHooks } from "../settings.js";

export interface InitArgs {
  cwd: string;
  url?: string;
  devCommand?: string;
  flowsDir?: string;
  /** Hooks come from the Claude Code plugin; don't write settings.json. */
  plugin: boolean;
  /** Write hooks to .claude/settings.local.json (not committed) instead of settings.json. */
  local: boolean;
  force: boolean;
  /** Absolute path of the kane-gate script the hooks should run. */
  scriptPath: string;
}

const GITIGNORE_LINES = [`${STATE_DIR}/`, ".testmuai/evidence/"];

export function exampleFlow(url: string): string {
  return [
    "---",
    `url: ${url}`,
    "tags: [smoke]",
    "---",
    "",
    "# Smoke: the app loads",
    "",
    "## Open the app",
    `Open ${url} and verify the page shows its main content and no error message.`,
    "",
  ].join("\n");
}

async function writeConfig(args: InitArgs, lines: string[]): Promise<string> {
  const file = join(args.cwd, CONFIG_FILE);
  if ((await pathExists(file)) && !args.force) {
    lines.push(`kept     ${CONFIG_FILE} (exists; --force to overwrite)`);
    const parsed = validateConfig(JSON.parse(await readFile(file, "utf8")) as unknown);
    return parsed.ok ? parsed.config.url : args.url ?? "http://localhost:3000";
  }
  const url = args.url ?? "http://localhost:3000";
  const config: Record<string, unknown> = { url, flowsDir: args.flowsDir ?? DEFAULTS.flowsDir };
  if (args.devCommand) config.devCommand = args.devCommand;
  Object.assign(config, { maxAttempts: DEFAULTS.maxAttempts, headless: DEFAULTS.headless, parallel: DEFAULTS.parallel, timeoutSec: DEFAULTS.timeoutSec, lockFlows: true, coverageNudge: true });
  const check = validateConfig(config);
  if (!check.ok) throw new Error(`invalid options: ${check.errors.join("; ")}`);
  await writeJsonAtomic(file, config);
  lines.push(`wrote    ${CONFIG_FILE}`);
  return url;
}

async function ensureFlows(args: InitArgs, url: string, lines: string[]): Promise<void> {
  const flowsDir = args.flowsDir ?? DEFAULTS.flowsDir;
  const flows = await discoverFlows(args.cwd, flowsDir);
  if (flows.length > 0) {
    lines.push(`found    ${flows.length} flow(s) in ${flowsDir}: ${flows.map((f) => f.name).join(", ")}`);
    return;
  }
  await mkdir(join(args.cwd, flowsDir), { recursive: true });
  await writeFile(join(args.cwd, flowsDir, "smoke_test.md"), exampleFlow(url), "utf8");
  lines.push(`wrote    ${flowsDir}/smoke_test.md (an example flow; describe your real user journeys next to it)`);
}

async function ensureGitignore(cwd: string, lines: string[]): Promise<void> {
  const file = join(cwd, ".gitignore");
  const current = (await pathExists(file)) ? await readFile(file, "utf8") : "";
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return;
  const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
  await writeFile(file, `${current}${prefix}# Kane Gate state and Kane evidence packs\n${missing.join("\n")}\n`, "utf8");
  lines.push(`updated  .gitignore (${missing.join(", ")})`);
}

async function wireHooks(args: InitArgs, lines: string[]): Promise<void> {
  if (args.plugin) {
    lines.push("hooks    provided by the kane-gate Claude Code plugin (settings untouched)");
    return;
  }
  const settings = join(args.cwd, ".claude", args.local ? "settings.local.json" : "settings.json");
  await mkdir(join(args.cwd, ".claude"), { recursive: true });
  await installHooks(settings, args.scriptPath);
  lines.push(`wired    Stop, PreToolUse, SessionStart and SessionEnd hooks in ${settings.slice(args.cwd.length + 1)}`);
}

async function checkKane(cwd: string, lines: string[]): Promise<boolean> {
  const status = await kaneStatus(DEFAULTS.kaneBin, cwd);
  if (!status.installed) {
    lines.push("kane     NOT FOUND: npm install -g @testmuai/kane-cli");
    return false;
  }
  if (status.loggedIn === false) {
    lines.push(`kane     ${status.version ?? "installed"}, NOT signed in: run \`kane-cli login\` in a terminal`);
    return false;
  }
  lines.push(`kane     ${status.version ?? "installed"}, signed in`);
  return true;
}

/** `kane-gate init`: config, an example flow, hook wiring, .gitignore, and a Kane CLI check. */
export async function initCommand(args: InitArgs): Promise<number> {
  const lines: string[] = [];
  const url = await writeConfig(args, lines);
  await ensureFlows(args, url, lines);
  await wireHooks(args, lines);
  await ensureGitignore(args.cwd, lines);
  const kaneReady = await checkKane(args.cwd, lines);
  out(["Kane Gate is set up.", "", ...lines.map((l) => `  ${l}`), ""].join("\n"));
  out(
    [
      "Next:",
      `  1. Describe your key user journeys as plain-English flows in ${args.flowsDir ?? DEFAULTS.flowsDir}/*_test.md.`,
      "  2. Run `kane-gate run --all` once to record them (later runs replay from cache in seconds).",
      "  3. Work with Claude Code as usual: it can't end a turn until the affected flows pass in a real browser.",
      kaneReady ? "" : "  (Kane CLI needs attention first, see above.)",
    ].join("\n"),
  );
  return 0;
}
