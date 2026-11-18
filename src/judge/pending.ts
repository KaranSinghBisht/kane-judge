import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * Projects under `<workspace>/projects` whose latest Kane run is recent and not
 * yet in a scorecard: Kane has answered, and the agent hasn't turned the answer
 * into a verdict that passed `kane-judge report`. Decided from what the files
 * say, never from their timestamps, so a copied or cloned folder is read right.
 */
export async function pendingProjects(workspace: string, now: number = Date.now()): Promise<string[]> {
  const root = join(workspace, PROJECTS_DIR);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const pending: string[] = [];
  for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).slice(0, MAX_PROJECTS)) {
    const paths = projectPaths(join(root, entry.name));
    const results = await readResults(paths.results);
    const lastRunAt = Date.parse(results?.runs[results.runs.length - 1]?.at ?? "");
    if (!results || Number.isNaN(lastRunAt) || now - lastRunAt > FRESH_MS) continue;
    if (await runInProgress(paths.dir, now)) continue;
    if ((await scorecardStamp(paths.scorecardHtml)) !== resultsStamp(results)) pending.push(`${PROJECTS_DIR}/${entry.name}`);
  }
  return pending;
}
