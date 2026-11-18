import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Reads and parses a JSON file. Returns undefined when the file does not exist. */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text) as unknown;
}

/** Writes JSON atomically (temp file + rename) so a killed process never leaves half a file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

/** Converts a path to forward slashes (git and glob style). */
export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Project-relative posix path, or undefined when `target` is outside `root`. */
export function relativeInside(root: string, target: string): string | undefined {
  const abs = isAbsolute(target) ? target : resolve(root, target);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return rel === "" ? "" : undefined;
  return toPosix(rel);
}

/** A path to show the user: relative to the working folder when it is inside it, absolute otherwise. */
export function displayPath(target: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, resolve(cwd, target));
  if (rel === "") return ".";
  return rel.startsWith("..") || isAbsolute(rel) ? resolve(cwd, target) : toPosix(rel);
}
