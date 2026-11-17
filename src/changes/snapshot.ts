import { changedBetweenCommits, dirtyFiles, gitContext } from "./git.js";
import type { ChangeSet, FileMap, Snapshot } from "./types.js";
import { walkFingerprints } from "./walk.js";

export type { ChangeSet, Snapshot } from "./types.js";

/** Captures the project's current state. Prefers git; falls back to a size+mtime walk. */
export async function takeSnapshot(
  projectDir: string,
  isIgnored: (path: string) => boolean,
): Promise<Snapshot | undefined> {
  const ctx = await gitContext(projectDir);
  if (ctx) {
    const files = await dirtyFiles(projectDir, ctx, isIgnored);
    if (files) return { kind: "git", head: ctx.head, files };
  }
  const files = await walkFingerprints(projectDir, isIgnored);
  return files ? { kind: "walk", files } : undefined;
}

/** Paths whose fingerprint differs between two maps (present in either). */
export function differingPaths(a: FileMap, b: FileMap): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

const UNKNOWN: ChangeSet = { files: [], unknown: true, baseline: "none" };

/**
 * What changed since `prev` (the last green run). Without a previous green
 * run, a git project is compared with HEAD (committed code is the baseline).
 */
export async function diffSnapshots(
  projectDir: string,
  prev: Snapshot | undefined,
  cur: Snapshot | undefined,
  isIgnored: (path: string) => boolean,
): Promise<ChangeSet> {
  if (!cur) return UNKNOWN;
  if (!prev) {
    if (cur.kind === "git") return { files: Object.keys(cur.files).sort(), unknown: false, baseline: "head" };
    return UNKNOWN;
  }
  if (prev.kind !== cur.kind) return UNKNOWN;
  const local = differingPaths(prev.files, cur.files);
  if (cur.kind === "walk" || prev.kind === "walk" || prev.head === cur.head) {
    return { files: local.filter((p) => !isIgnored(p)), unknown: false, baseline: "last-green" };
  }
  if (!prev.head || !cur.head) return { ...UNKNOWN, baseline: "last-green" };
  const ctx = await gitContext(projectDir);
  const committed = ctx ? await changedBetweenCommits(projectDir, ctx, prev.head, cur.head) : undefined;
  if (!committed) return { ...UNKNOWN, baseline: "last-green" };
  const files = [...new Set([...committed, ...local])].filter((p) => !isIgnored(p)).sort();
  return { files, unknown: false, baseline: "last-green" };
}
