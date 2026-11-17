import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileMap } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".kane-gate", ".testmuai", ".claude", ".hyperexecute"]);
export const WALK_FILE_LIMIT = 20_000;

/**
 * Fallback for projects without git: size+mtime of every file. Returns
 * undefined when the project is too large to fingerprint cheaply.
 */
export async function walkFingerprints(
  projectDir: string,
  isIgnored: (path: string) => boolean,
): Promise<FileMap | undefined> {
  const files: FileMap = {};
  let count = 0;
  const queue: string[] = [""];
  while (queue.length > 0) {
    const rel = queue.shift() ?? "";
    const entries = await readdir(join(projectDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const skip = SKIP_DIRS.has(entry.name) || /^(output-|helper-output-)/.test(entry.name);
        if (!skip) queue.push(childRel);
        continue;
      }
      if (!entry.isFile() || isIgnored(childRel)) continue;
      if (++count > WALK_FILE_LIMIT) return undefined;
      const info = await stat(join(projectDir, childRel));
      files[childRel] = `${info.size}:${Math.floor(info.mtimeMs)}`;
    }
  }
  return files;
}
