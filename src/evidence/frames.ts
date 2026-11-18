import { join } from "node:path";
import { safeMessage } from "../shared/errors.js";
import { log } from "../shared/logger.js";
import { pickTestDir, writeBytes, type PackTarget } from "./pack.js";
import { ZipReader } from "./zip.js";

/**
 * One step of a Kane run as a judge can replay it: the screenshot Kane took
 * and Kane's own line about what it did there.
 */
export interface StepFrame {
  /** Where the screenshot was written. */
  path: string;
  ordinal: number;
  /** Kane's step kind: navigate, click, type, wait, analyze, assert. */
  kind?: string;
  status?: string;
  /** Kane's one line about the step, e.g. `click: Click "Apply"`. */
  summary?: string;
}

export interface FrameLimits {
  maxFrames: number;
  maxFrameBytes: number;
  maxTotalBytes: number;
}

export const FRAME_LIMITS: FrameLimits = { maxFrames: 14, maxFrameBytes: 600_000, maxTotalBytes: 2_500_000 };

const SHOT = /\/steps\/([^/]+)\/screenshot\.(png|jpe?g)$/;
const SUMMARY_LIMIT = 160;

interface Candidate {
  entry: string;
  dir: string;
  ordinal: number;
  kind?: string;
  status?: string;
  summary?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** "wait: PRIMARY: wait for the Checkout heading" -> "wait: wait for the Checkout heading" (one line, capped). */
function tidy(summary: string | undefined): string | undefined {
  if (!summary) return undefined;
  const line = summary.replace(/\s+/g, " ").replace(/\bPRIMARY:\s*/g, "").trim();
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT - 1)}…` : line;
}

function readStepMeta(zip: ZipReader, dir: string): Pick<Candidate, "kind" | "status" | "summary"> {
  const raw = zip.readText(`${dir}/step.json`);
  if (!raw) return {};
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>;
    return { kind: text(meta.kind), status: text(meta.status), summary: tidy(text(meta.summary)) };
  } catch {
    return {};
  }
}

function candidates(zip: ZipReader, testDir: string): Candidate[] {
  return zip.names
    .filter((n) => n.startsWith(`${testDir}/steps/`) && SHOT.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((entry) => {
      const dir = entry.slice(0, entry.lastIndexOf("/"));
      const ordinal = Number.parseInt(dir.split("/").pop() ?? "", 10);
      return { entry, dir, ordinal: Number.isFinite(ordinal) ? ordinal : 0, ...readStepMeta(zip, dir) };
    });
}

/** Adds `count` indexes from `pool`, spread evenly over it. */
function takeEvenly(pool: number[], count: number, into: Set<number>): void {
  for (let k = 0; k < count && pool.length > 0; k++) {
    const index = pool[Math.floor((k * pool.length) / count)];
    if (index !== undefined) into.add(index);
  }
}

/**
 * At most `max` steps. The first, the last and every failed step always stay;
 * of the others, waits are dropped before anything else, and what remains is thinned evenly.
 */
export function chooseFrames<T extends { kind?: string; status?: string }>(steps: T[], max: number): T[] {
  if (steps.length <= max) return steps;
  const keep = new Set<number>();
  steps.forEach((step, i) => {
    if (i === 0 || i === steps.length - 1 || step.status === "failed") keep.add(i);
  });
  const optional = steps.map((_, i) => i).filter((i) => !keep.has(i));
  const actions = optional.filter((i) => steps[i]?.kind !== "wait");
  const waits = optional.filter((i) => steps[i]?.kind === "wait");
  const room = Math.max(0, max - keep.size);
  if (actions.length >= room) takeEvenly(actions, room, keep);
  else {
    for (const i of actions) keep.add(i);
    takeEvenly(waits, Math.min(room - actions.length, waits.length), keep);
  }
  return steps.filter((_, i) => keep.has(i));
}

/**
 * Extracts the step screenshots of one test from a sealed evidence pack, in
 * order, so a scorecard can replay what Kane did. Best effort: an unreadable
 * pack, or frames over the size limits, simply yield fewer (or no) frames.
 */
export async function readStepFrames(packPath: string, target: PackTarget, destDir: string, limits: FrameLimits = FRAME_LIMITS): Promise<StepFrame[]> {
  let zip: ZipReader;
  try {
    zip = await ZipReader.open(packPath);
  } catch (err) {
    log.warn(`could not open evidence pack ${packPath}: ${safeMessage(err)}`);
    return [];
  }
  const testDir = pickTestDir(zip, target);
  if (!testDir) return [];
  const chosen = chooseFrames(candidates(zip, testDir), limits.maxFrames);
  const bytes = zip.readBytes(chosen.map((c) => c.entry));
  const frames: StepFrame[] = [];
  let total = 0;
  for (const step of chosen) {
    const data = bytes.get(step.entry);
    if (!data || data.byteLength > limits.maxFrameBytes || total + data.byteLength > limits.maxTotalBytes) continue;
    const ext = /\.png$/i.test(step.entry) ? "png" : "jpg";
    const path = join(destDir, `${String(step.ordinal).padStart(2, "0")}.${ext}`);
    if (!(await writeBytes(data, path))) continue;
    total += data.byteLength;
    frames.push({ path, ordinal: step.ordinal, kind: step.kind, status: step.status, summary: step.summary });
  }
  return frames;
}
