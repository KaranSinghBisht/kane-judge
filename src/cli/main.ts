import { parseArgs } from "node:util";
import { safeMessage } from "../shared/errors.js";
import { log, out } from "../shared/logger.js";
import { demoCommand } from "./commands/demo.js";
import { doctorCommand } from "./commands/doctor.js";
import { guardHookCommand, stopHookCommand } from "./commands/hook.js";
import { boardCommand, reportCommand } from "./commands/report.js";
import { runFlowsCommand } from "./commands/run.js";
import { scanCommand } from "./commands/scan.js";
import { shareCommand } from "./commands/share.js";
import { sourceCommand } from "./commands/source.js";
import { withdrawCommand } from "./commands/withdraw.js";

const VERSION = "0.3.0";

const HELP = `kane-judge ${VERSION}: judge hackathon projects by using their live demos, with Kane CLI.

Usage:
  kane-judge scan <submission-url|repo-url|folder>... [--live <url>] [--name <name>] [--slug <slug>]
                  [--since <date>] [--until <date>] [--workspace <dir>] [--preflight] [--no-use-cases]
      Read the submission page, repo or local folder (never runs project code) into projects/<slug>/.
      A GitHub /tree/<branch>/<folder> URL scans just that folder of a monorepo.
      --preflight marks your own folder for pre-flight: only then may a verdict record fixes.
      Kane is asked which use-cases the README promises (kane-cli context ingest, about 2 credits);
      every one has to be covered by a claim in the verdict. --no-use-cases skips that.
  kane-judge run <project-dir> [--only <flow>]... [--start-url <url>] [--gate [--heal]] [--headed] [--parallel <n>] [--timeout <sec>]
      Run the project's Kane flows in real Chrome; save evidence to kane-results.json.
      Kane's verdict engine then judges the sealed evidence pack (kane-cli evidence verdict).
      --start-url replays the same flows against another build, e.g. the deployed one after a local fix.
      --gate exits 1 unless every flow passed and Kane's verdict is a pass (pre-push hooks, CI).
      A gate run turns Kane's self-healing off (--no-adaptive-heal), so a pass is the recorded test
      replayed as recorded; --heal allows healing.
      Four flows run at a time; the run stops after 9 minutes unless --timeout says otherwise.
  kane-judge withdraw <project-dir> <flow>
      Pre-flight: move a withdrawn claim's flow out of flows/, so runs no longer include it.
  kane-judge report <project-dir>
      Check verdict.json against Kane's results and write scorecard.html and report.md.
  kane-judge board [<workspace>]
      Rank every judged project: SCOREBOARD.md and scoreboard.html.
  kane-judge share <project-dir> [--out <dir>]
      Make a copy you can commit or send: flows, results, verdict, scorecard and Kane's evidence packs,
      with your Kane account and this machine's paths removed. The copy is checked like any project.
  kane-judge demo [<share-copy-dir>] [--no-open]
      Replay a real judged run on this machine, with no Kane account and no credits: re-read Kane's
      evidence, then try to cheat the scorecard eight ways and watch each one refused.
      Without a folder it replays the run that ships with Kane Judge.
  kane-judge source <repo-url> [path...]
      List a GitHub repo's files, or print up to 8 of them (read-only: nothing is cloned or run).
  kane-judge doctor
      Check Kane CLI (installed, signed in), Chrome and the GitHub CLI.

Set KANE_JUDGE_HEADED=1 to watch Kane drive a visible Chrome window.
Exit codes: 0 ok, 1 gate failed (run --gate), 2 setup problem or invalid input.`;

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
    options: {
      live: { type: "string" },
      name: { type: "string" },
      slug: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      workspace: { type: "string" },
      preflight: { type: "boolean", default: false },
      "no-use-cases": { type: "boolean", default: false },
    },
  });
  return scanCommand({ inputs: positionals, ...values, noUseCases: values["no-use-cases"], workspace: values.workspace ?? process.cwd() });
}

async function run(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      only: { type: "string", multiple: true },
      headed: { type: "boolean", default: false },
      parallel: { type: "string" },
      timeout: { type: "string" },
      "start-url": { type: "string" },
      gate: { type: "boolean", default: false },
      heal: { type: "boolean", default: false },
    },
  });
  const dir = positionals[0];
  if (!dir) throw new Error("usage: kane-judge run <project-dir>");
  const startUrl = values["start-url"];
  if (startUrl !== undefined && !/^https?:\/\/[^\s]+$/i.test(startUrl)) throw new Error(`--start-url must be an http(s) URL (got ${startUrl})`);
  const headedEnv = process.env.KANE_JUDGE_HEADED === "1" || process.env.KANE_JUDGE_HEADED === "true";
  const config = {
    headless: !(values.headed || headedEnv),
    ...(values.parallel ? { parallel: intOption(values.parallel, "--parallel", [1, 8]) } : {}),
    ...(values.timeout ? { timeoutSec: intOption(values.timeout, "--timeout", [30, 3600]) } : {}),
    ...(startUrl ? { startUrl } : {}),
  };
  return runFlowsCommand({ dir, only: (values.only ?? []).flatMap((o) => o.split(",")).map((o) => o.trim()).filter(Boolean), config, gate: values.gate, heal: values.heal });
}

async function share(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: "string" } } });
  const dir = positionals[0];
  if (!dir) throw new Error("usage: kane-judge share <project-dir> [--out <dir>]");
  return shareCommand({ dir, out: values.out });
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
  if (command === "demo") return demoCommand({ open: !rest.includes("--no-open"), example: rest.find((arg) => !arg.startsWith("--")) });
  if (command === "share") return share(rest);
  if (command === "withdraw") return withdrawCommand(rest[0], rest[1]);
  // A hook must never fail a session: anything but a known hook name is a silent no-op.
  if (command === "hook") return rest[0] === "stop" ? stopHookCommand() : rest[0] === "guard" ? guardHookCommand() : 0;
  if (command === "source") return sourceCommand(rest[0], rest.slice(1));
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
