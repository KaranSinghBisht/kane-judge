import { spawn } from "node:child_process";

export interface RunOptions {
  cwd: string;
  /** Wall-clock limit. On expiry the child gets SIGINT, then SIGTERM, then SIGKILL. */
  timeoutMs?: number;
  /** Time between escalating signals after a timeout. */
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Called for every complete stdout line, as it arrives. */
  onStdoutLine?: (line: string) => void;
  /** Max stdout bytes kept in memory; older output is dropped first. */
  maxStdoutBytes?: number;
  /** Max stderr bytes kept (the tail). */
  maxStderrBytes?: number;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError?: NodeJS.ErrnoException;
  durationMs: number;
}

class TailBuffer {
  private chunks: string[] = [];
  private size = 0;
  constructor(private readonly limit: number) {}

  push(text: string): void {
    this.chunks.push(text);
    this.size += text.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()?.length ?? 0;
    }
  }

  toString(): string {
    const joined = this.chunks.join("");
    return joined.length > this.limit ? joined.slice(joined.length - this.limit) : joined;
  }
}

function lineSplitter(onLine: ((line: string) => void) | undefined): (chunk: string) => void {
  let pending = "";
  return (chunk: string) => {
    if (!onLine) return;
    pending += chunk;
    let idx = pending.indexOf("\n");
    while (idx >= 0) {
      onLine(pending.slice(0, idx).replace(/\r$/, ""));
      pending = pending.slice(idx + 1);
      idx = pending.indexOf("\n");
    }
  };
}

/**
 * Runs a program WITHOUT a shell (arguments are passed as an argv array, so
 * nothing in them is ever interpreted). stdin is closed (/dev/null), which is
 * also what makes `kane-cli testrun run` emit NDJSON.
 */
export function runCommand(command: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const stdoutBuf = new TailBuffer(opts.maxStdoutBytes ?? 32 * 1024 * 1024);
  const stderrBuf = new TailBuffer(opts.maxStderrBytes ?? 256 * 1024);
  const onStdout = lineSplitter(opts.onStdoutLine);

  return new Promise((resolvePromise) => {
    let settled = false;
    let timedOut = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (result: Omit<RunResult, "durationMs" | "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      resolvePromise({
        ...result,
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf.push(chunk);
      onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => stderrBuf.push(chunk));
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish({ exitCode: null, signal: null, spawnError: err });
    });
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const grace = opts.killGraceMs ?? 30_000;
      timers.push(
        setTimeout(() => {
          timedOut = true;
          child.kill("SIGINT");
          timers.push(setTimeout(() => child.kill("SIGTERM"), grace));
          timers.push(setTimeout(() => child.kill("SIGKILL"), grace * 2));
        }, opts.timeoutMs),
      );
    }
  });
}
