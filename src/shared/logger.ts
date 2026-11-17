import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Tiny logger. Diagnostics go to stderr (never stdout: in hook mode stdout
 * carries the JSON decision Claude Code reads) and, when configured, to a log
 * file inside `.kane-gate/`. Debug lines only appear with KANE_GATE_DEBUG=1.
 */
type Level = "debug" | "info" | "warn" | "error";

let logFile: string | undefined;
let echoToStderr = true;

export function configureLogger(opts: { file?: string; stderr?: boolean }): void {
  logFile = opts.file;
  if (opts.stderr !== undefined) echoToStderr = opts.stderr;
}

function debugEnabled(): boolean {
  const v = process.env.KANE_GATE_DEBUG;
  return v === "1" || v === "true";
}

function write(level: Level, message: string): void {
  if (level === "debug" && !debugEnabled()) return;
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`;
  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, line);
    } catch {
      // The log file is best-effort: a read-only checkout must not break the gate.
      // Fall through to stderr so the line is not lost.
      process.stderr.write(`kane-gate: could not write log file ${logFile}\n`);
    }
  }
  if (echoToStderr && (level !== "debug" || debugEnabled())) {
    process.stderr.write(`kane-gate ${level}: ${message}\n`);
  }
}

export const log = {
  debug: (m: string) => write("debug", m),
  info: (m: string) => write("info", m),
  warn: (m: string) => write("warn", m),
  error: (m: string) => write("error", m),
};

/** User-facing output (CLI text or hook JSON). The only path to stdout. */
export function out(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}
