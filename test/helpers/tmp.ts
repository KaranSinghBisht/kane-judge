import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

/**
 * Registers an `afterEach` hook that deletes every directory handed out by the
 * returned factory. Call it once per test file (or describe block), then
 * `await makeDir()` inside the tests.
 */
export function useTempDirs(prefix = "kane-judge-test-"): () => Promise<string> {
  const created: string[] = [];
  afterEach(async () => {
    const dirs = created.splice(0);
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  return async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    created.push(dir);
    return dir;
  };
}

/** Writes `files` (project-relative path -> content) under `root`, creating parent directories. */
export async function writeTree(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

/** Narrows `T | undefined` for array lookups under `noUncheckedIndexedAccess`; fails the test when absent. */
export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be defined`);
  return value;
}
