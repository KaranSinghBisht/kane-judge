import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathExists } from "../shared/fs.js";
import { CONFIG_FILE, type KaneGateConfig } from "./schema.js";
import { validateConfig } from "./validate.js";

export type LoadedConfig =
  | { kind: "absent" }
  | { kind: "invalid"; projectDir: string; file: string; errors: string[] }
  | { kind: "ok"; projectDir: string; file: string; config: KaneGateConfig; warnings: string[] };

/**
 * Finds the project that owns `startDir`: the nearest ancestor holding
 * kane-gate.json, stopping at the enclosing git root (or the filesystem root).
 */
export async function findProjectDir(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);
  for (;;) {
    if (await pathExists(join(dir, CONFIG_FILE))) return dir;
    if (await pathExists(join(dir, ".git"))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function loadConfigFrom(projectDir: string): Promise<LoadedConfig> {
  const file = join(projectDir, CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "parse error";
    return { kind: "invalid", projectDir, file, errors: [`${CONFIG_FILE} is not valid JSON: ${detail}`] };
  }
  const result = validateConfig(raw);
  if (!result.ok) return { kind: "invalid", projectDir, file, errors: result.errors };
  return { kind: "ok", projectDir, file, config: result.config, warnings: result.warnings };
}

/** Locates and loads the config for a working directory (a hook's `cwd`, or the CLI's). */
export async function loadConfig(cwd: string, projectDirHint?: string): Promise<LoadedConfig> {
  const found = (await findProjectDir(cwd)) ?? (projectDirHint ? await findProjectDir(projectDirHint) : undefined);
  if (!found) return { kind: "absent" };
  return loadConfigFrom(found);
}
