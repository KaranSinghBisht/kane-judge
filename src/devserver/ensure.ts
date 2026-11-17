import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { STATE_DIR, type KaneGateConfig } from "../config/schema.js";
import { redact, safeMessage } from "../shared/errors.js";
import { readJsonFile, writeJsonAtomic } from "../shared/fs.js";
import { log } from "../shared/logger.js";

export type AppStatus =
  | { ok: true; started: boolean }
  /** Nothing is listening and there is no devCommand: a setup problem, not the agent's fault. */
  | { ok: false; kind: "unreachable"; reason: string }
  /** devCommand ran but the app never came up: usually the code is broken. */
  | { ok: false; kind: "start-failed"; reason: string; logTail?: string };

interface DevServerRecord {
  pid: number;
  startedAt: string;
  command: string[];
}

const recordFile = (projectDir: string) => join(projectDir, STATE_DIR, "dev-server.json");
const logFile = (projectDir: string) => join(projectDir, STATE_DIR, "dev-server.log");

/** True when the URL answers with any non-5xx response within the timeout. */
export async function probe(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

async function tail(path: string, lines = 15): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return redact(text.trimEnd().split(/\r?\n/).slice(-lines).join("\n")) || undefined;
  } catch {
    return undefined;
  }
}

function startDetached(projectDir: string, command: string[]): { pid?: number; exited: () => boolean } {
  const fd = openSync(logFile(projectDir), "a");
  let exited = false;
  try {
    const child = spawn(command[0] ?? "", command.slice(1), {
      cwd: projectDir,
      detached: true,
      shell: false,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    child.on("exit", () => (exited = true));
    child.on("error", (err) => {
      exited = true;
      log.warn(`devCommand failed to start: ${safeMessage(err)}`);
    });
    child.unref();
    return { pid: child.pid, exited: () => exited };
  } finally {
    closeSync(fd);
  }
}

async function waitForReady(url: string, timeoutSec: number, exited: () => boolean): Promise<"ready" | "exited" | "timeout"> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await probe(url, 2000)) return "ready";
    if (exited()) return "exited";
    await new Promise((r) => setTimeout(r, 500));
  }
  return "timeout";
}

/** Makes sure the app under test answers at its URL, starting `devCommand` (detached) when needed. */
export async function ensureApp(projectDir: string, config: KaneGateConfig): Promise<AppStatus> {
  const readyUrl = config.readyUrl ?? config.url;
  if (await probe(readyUrl)) return { ok: true, started: false };
  if (!config.devCommand) {
    const reason = `The app at ${readyUrl} is not reachable and kane-gate.json has no "devCommand". Start the app (or add devCommand) so Kane can test it.`;
    return { ok: false, kind: "unreachable", reason };
  }
  await mkdir(join(projectDir, STATE_DIR), { recursive: true });
  const command = config.devCommand;
  log.info(`starting dev server: ${command.join(" ")}`);
  const child = startDetached(projectDir, command);
  if (child.pid) await writeJsonAtomic(recordFile(projectDir), { pid: child.pid, startedAt: new Date().toISOString(), command });
  const state = await waitForReady(readyUrl, config.readyTimeoutSec, child.exited);
  if (state === "ready") return { ok: true, started: true };
  const reason =
    state === "exited"
      ? `The dev server (${command.join(" ")}) exited before ${readyUrl} came up.`
      : `The dev server (${command.join(" ")}) did not answer at ${readyUrl} within ${config.readyTimeoutSec}s.`;
  return { ok: false, kind: "start-failed", reason, logTail: await tail(logFile(projectDir)) };
}

/** Stops a dev server that Kane Gate started (its whole process group). */
export async function stopDevServer(projectDir: string): Promise<boolean> {
  const record = (await readJsonFile(recordFile(projectDir))) as DevServerRecord | undefined;
  if (!record || typeof record.pid !== "number") return false;
  try {
    process.kill(-record.pid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") log.warn(`could not stop dev server: ${safeMessage(err)}`);
  }
  await rm(recordFile(projectDir), { force: true });
  return true;
}
