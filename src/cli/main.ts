import { parseArgs } from "node:util";
import { safeMessage } from "../shared/errors.js";
import { log, out } from "../shared/logger.js";
import { doctorCommand } from "./commands/doctor.js";
import { boardCommand, reportCommand } from "./commands/report.js";
import { runFlowsCommand } from "./commands/run.js";
import { scanCommand } from "./commands/scan.js";

const VERSION = "0.1.0";

const HELP = `kane-judge ${VERSION}: judge hackathon projects by using their live demos, with Kane CLI.

Usage:
  kane-judge scan <submission-url|repo-url>... [--live <url>] [--name <name>] [--slug <slug>]
                  [--since <date>] [--until <date>] [--workspace <dir>]
      Read the submission page and repo (never runs project code) into projects/<slug>/.
  kane-judge run <project-dir> [--only <flow>]... [--headed] [--parallel <n>] [--timeout <sec>]
      Run the project's Kane flows in real Chrome; save evidence to kane-results.json.
  kane-judge report <project-dir>
      Validate verdict.json and write scorecard.html and report.md.
  kane-judge board [<workspace>]
      Rank every judged project: SCOREBOARD.md and scoreboard.html.
  kane-judge doctor
      Check Kane CLI (installed, signed in), Chrome and the GitHub CLI.

Set KANE_JUDGE_HEADED=1 to watch Kane drive a visible Chrome window.
Exit codes: 0 ok, 2 setup problem or invalid input.`;

function intOption(value: string | undefined, name: string, range: [number, number]): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < range[0] || n > range[1]) throw new Error(`${name} must be an integer from ${range[0]} to ${range[1]}`);
  return n;
}

async function scan(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { live: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, since: { type: "string" }, until: { type: "string" }, workspace: { type: "string" } },
  });
  return scanCommand({ inputs: positionals, ...values, workspace: values.workspace ?? process.cwd() });
}

async function run(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { only: { type: "string", multiple: true }, headed: { type: "boolean", default: false }, parallel: { type: "string" }, timeout: { type: "string" } },
  });
  const dir = positionals[0];
  if (!dir) throw new Error("usage: kane-judge run <project-dir>");
  const headedEnv = process.env.KANE_JUDGE_HEADED === "1" || process.env.KANE_JUDGE_HEADED === "true";
  const config = {
    headless: !(values.headed || headedEnv),
    ...(values.parallel ? { parallel: intOption(values.parallel, "--parallel", [1, 8]) } : {}),
    ...(values.timeout ? { timeoutSec: intOption(values.timeout, "--timeout", [30, 3600]) } : {}),
  };
  return runFlowsCommand({ dir, only: (values.only ?? []).flatMap((o) => o.split(",")).map((o) => o.trim()).filter(Boolean), config });
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
  if (command === "scan") return scan(rest);
  if (command === "run") return run(rest);
  if (command === "report") return rest[0] ? reportCommand(rest[0]) : (out("usage: kane-judge report <project-dir>"), 2);
  if (command === "board") return boardCommand(rest[0] ?? process.cwd());
  if (command === "doctor") return doctorCommand();
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
