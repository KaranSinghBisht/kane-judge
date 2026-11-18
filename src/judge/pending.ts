import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isKaneResults, resultsStamp, type KaneResults } from "./results.js";
import { PROJECTS_DIR, projectPaths } from "./workspace.js";

/** Runs older than this belong to an earlier sitting, not to the work the agent is ending now. */
const FRESH_MS = 60 * 60 * 1000;
/** A run marker older than this is a leftover from a run that was killed. */
const RUN_MARKER_MAX_MS = 30 * 60 * 1000;
const MAX_PROJECTS = 60;
const HEAD_BYTES = 4096;
/** Matches the tag `renderScorecard` writes (RESULTS_META in scorecard.ts). */
const STAMP = /<meta name="kane-judge-results" content="([0-9a-f]+)">/;

export const RUN_MARKER = join(".kane-judge", "running.json");
/** Holds the results fingerprint the Stop hook last spoke up about, so it reminds once per Kane run, not at every stop. */
const NUDGE_MARKER = join(".kane-judge", "stop-nudged");

export interface PendingProject {
  /** `projects/<folder>`, as the reminder names it. */
  name: string;
  dir: string;
  /** Fingerprint of the Kane runs that are waiting for a scorecard. */
  stamp: string;
}

async function readResults(path: string): Promise<KaneResults | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isKaneResults(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The fingerprint of the Kane runs a scorecard was built from, read from its <head>. */
async function scorecardStamp(path: string): Promise<string | undefined> {
  let file;
  try {
    file = await open(path, "r");
    const { buffer, bytesRead } = await file.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    return STAMP.exec(buffer.subarray(0, bytesRead).toString("utf8"))?.[1];
  } catch {
    return undefined;
  } finally {
    await file?.close();
  }
}

/** True while `kane-judge run` is still working in the project (the agent is waiting on it, not walking away). */
async function runInProgress(projectDir: string, now: number): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(projectDir, RUN_MARKER), "utf8")) as { startedAt?: number };
    return typeof marker.startedAt === "number" && now - marker.startedAt < RUN_MARKER_MAX_MS;
  } catch {
    return false;
  }
}

/** The `projects/` folder of the workspace `cwd` is in: in `cwd` itself, or up to three levels above it. */
async function projectsRoot(cwd: string): Promise<string | undefined> {
  let dir = cwd;
  for (let level = 0; level < 4; level++) {
    const candidate = join(dir, PROJECTS_DIR);
    const listed = await readdir(candidate).then(
      () => true,
      () => false,
    );
    if (listed) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Projects under `<workspace>/projects` whose latest Kane run is recent and not
 * yet in a scorecard: Kane has answered, and the agent hasn't turned the answer
 * into a verdict that passed `kane-judge report`. Decided from what the files
 * say, never from their timestamps, so a copied or cloned folder is read right.
 */
export async function pendingProjects(cwd: string, now: number = Date.now()): Promise<string[]> {
  return (await pendingWork(cwd, now)).map((p) => p.name);
}

/** Remembers that the agent was reminded about these results, so the same results never block a stop twice. */
export async function recordNudge(pending: PendingProject[]): Promise<void> {
  for (const project of pending) {
    await mkdir(join(project.dir, ".kane-judge"), { recursive: true });
    await writeFile(join(project.dir, NUDGE_MARKER), project.stamp, "utf8");
  }
}

async function nudgedStamp(projectDir: string): Promise<string | undefined> {
  return readFile(join(projectDir, NUDGE_MARKER), "utf8").then(
    (text) => text.trim(),
    () => undefined,
  );
}

/** `pendingProjects`, with what is needed to remember the reminder. Results the agent was already reminded about are left out. */
export async function pendingWork(cwd: string, now: number = Date.now()): Promise<PendingProject[]> {
  const root = await projectsRoot(cwd);
  if (!root) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const pending: PendingProject[] = [];
  for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).slice(0, MAX_PROJECTS)) {
    const paths = projectPaths(join(root, entry.name));
    const results = await readResults(paths.results);
    const lastRun = results?.runs[results.runs.length - 1];
    const lastRunAt = Date.parse(lastRun?.at ?? "");
    if (!results || Number.isNaN(lastRunAt) || now - lastRunAt > FRESH_MS) continue;
    // A run Kane could not start (signed out, timed out) left nothing to report on.
    if (lastRun?.outcome !== "passed" && lastRun?.outcome !== "failed") continue;
    if (await runInProgress(paths.dir, now)) continue;
    const stamp = resultsStamp(results);
    if ((await scorecardStamp(paths.scorecardHtml)) === stamp || (await nudgedStamp(paths.dir)) === stamp) continue;
    pending.push({ name: `${PROJECTS_DIR}/${entry.name}`, dir: paths.dir, stamp });
  }
  return pending;
}
