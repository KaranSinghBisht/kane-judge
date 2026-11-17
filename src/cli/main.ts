import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { safeMessage } from "../shared/errors.js";
import { log, out } from "../shared/logger.js";
import { hookCommand } from "./commands/hook.js";
import { initCommand } from "./commands/init.js";
import { runVerifyCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";

const VERSION = "0.1.0";

const HELP = `kane-gate ${VERSION}: your coding agent can't say "done" until a real browser agrees.

Usage:
  kane-gate init [--url <url>] [--dev-command "<cmd>"] [--flows-dir <dir>] [--plugin] [--local] [--force]
      Create kane-gate.json and an example flow, wire the Claude Code hooks
      (skip with --plugin when using the plugin), update .gitignore, check Kane CLI.
  kane-gate run [--all] [--flow <name>]... [--json]
      Verify now: run the Kane flows affected by changes since the last green run.
  kane-gate status
      Show the config, flows and what they cover, pending changes, and gate state.
  kane-gate hook <stop|guard|session-start|session-end>
      Claude Code hook entry point (reads the hook JSON on stdin).

Exit codes for run: 0 verified (or nothing to verify), 1 a flow failed, 2 setup problem.`;

function scriptPath(): string {
  const entry = process.argv[1] ?? "";
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    out(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    out(VERSION);
    return 0;
  }
  if (command === "hook") return hookCommand(rest[0]);
  if (command === "status") return statusCommand(process.cwd());
  if (command === "run") {
    const { values } = parseArgs({
      args: rest,
      options: { all: { type: "boolean", default: false }, flow: { type: "string", multiple: true }, json: { type: "boolean", default: false } },
      strict: true,
    });
    return runVerifyCommand({ cwd: process.cwd(), all: values.all ?? false, flows: values.flow ?? [], json: values.json ?? false });
  }
  if (command === "init") {
    const { values } = parseArgs({
      args: rest,
      options: {
        url: { type: "string" },
        "dev-command": { type: "string" },
        "flows-dir": { type: "string" },
        plugin: { type: "boolean", default: false },
        local: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      strict: true,
    });
    return initCommand({
      cwd: process.cwd(),
      url: values.url,
      devCommand: values["dev-command"],
      flowsDir: values["flows-dir"],
      plugin: values.plugin ?? false,
      local: values.local ?? false,
      force: values.force ?? false,
      scriptPath: scriptPath(),
    });
  }
  out(`Unknown command "${command}".\n\n${HELP}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log.error(safeMessage(err));
    process.exitCode = 2;
  },
);
