import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Snapshot } from "../changes/types.js";
import { STATE_DIR } from "../config/schema.js";
import { safeMessage } from "../shared/errors.js";
import { readJsonFile, writeJsonAtomic } from "../shared/fs.js";
import { log } from "../shared/logger.js";

/** Per-session progress through the gate. A "round" starts when the user sends a new prompt. */
export interface SessionRound {
  /** Times the gate blocked Claude for failing flows in the current round. */
  attempts: number;
  /** Set once the gate gave up for this round (attempt cap reached). */
  gaveUp?: boolean;
  /** Fingerprint of the uncovered-file set we already nudged about (nudge once per set). */
  nudged?: string;
  lastOutcome?: string;
  updatedAt: string;
}

export interface GreenRecord {
  at: string;
  snapshot: Snapshot;
  flows: string[];
  evidencePath?: string;
}

export interface GateState {
  version: 1;
  lastGreen?: GreenRecord;
  sessions: Record<string, SessionRound>;
}

const STATE_FILE = "state.json";
const LOCK_FILE = "run.lock";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export const stateDir = (projectDir: string) => join(projectDir, STATE_DIR);

function emptyState(): GateState {
  return { version: 1, sessions: {} };
}

function isGateState(value: unknown): value is GateState {
  const v = value as GateState | undefined;
  return !!v && v.version === 1 && typeof v.sessions === "object" && v.sessions !== null;
}

export async function loadState(projectDir: string): Promise<GateState> {
  try {
    const raw = await readJsonFile(join(stateDir(projectDir), STATE_FILE));
    if (raw === undefined) return emptyState();
    if (isGateState(raw)) return raw;
    log.warn("ignoring unrecognised .kane-gate/state.json (it will be rewritten)");
  } catch (err) {
    log.warn(`could not read .kane-gate/state.json (${safeMessage(err)}); starting fresh`);
  }
  return emptyState();
}

export async function saveState(projectDir: string, state: GateState): Promise<void> {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, round] of Object.entries(state.sessions)) {
    if (Date.parse(round.updatedAt) < cutoff) delete state.sessions[id];
  }
  await writeJsonAtomic(join(stateDir(projectDir), STATE_FILE), state);
}

export function roundFor(state: GateState, sessionId: string): SessionRound {
  const existing = state.sessions[sessionId];
  if (existing) return existing;
  const fresh: SessionRound = { attempts: 0, updatedAt: new Date().toISOString() };
  state.sessions[sessionId] = fresh;
  return fresh;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Exclusive run lock so two verifications never drive Chrome at once. A lock
 * whose owner process is gone (or that is older than `staleMs`) is taken over.
 */
export async function acquireLock(projectDir: string, staleMs: number): Promise<(() => Promise<void>) | undefined> {
  const path = join(stateDir(projectDir), LOCK_FILE);
  await mkdir(stateDir(projectDir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await handle.close();
      return () => rm(path, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (!(await isStale(path, staleMs))) return undefined;
      await rm(path, { force: true });
    }
  }
  return undefined;
}

async function isStale(path: string, staleMs: number): Promise<boolean> {
  try {
    const info = JSON.parse(await readFile(path, "utf8")) as { pid?: number; at?: number };
    if (typeof info.pid !== "number" || !pidAlive(info.pid)) return true;
    return typeof info.at === "number" && Date.now() - info.at > staleMs;
  } catch {
    return true;
  }
}
