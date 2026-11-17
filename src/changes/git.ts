import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../shared/proc.js";
import type { FileMap } from "./types.js";

const HASH_LIMIT_BYTES = 5 * 1024 * 1024;

export interface GitContext {
  /** Project dir relative to the repo root, with a trailing slash ("" at the root). */
  prefix: string;
  head: string | null;
}

async function git(projectDir: string, args: string[]): Promise<string | undefined> {
  const result = await runCommand("git", args, { cwd: projectDir, timeoutMs: 30_000, killGraceMs: 2_000 });
  if (result.spawnError || result.exitCode !== 0) return undefined;
  return result.stdout;
}

/** Returns git details for the project, or undefined when it is not inside a git work tree. */
export async function gitContext(projectDir: string): Promise<GitContext | undefined> {
  const inside = await git(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return undefined;
  const prefix = (await git(projectDir, ["rev-parse", "--show-prefix"]))?.trim() ?? "";
  const head = (await git(projectDir, ["rev-parse", "--verify", "--quiet", "HEAD"]))?.trim() || null;
  return { prefix, head };
}

/** Hash of a file's content ("deleted" when it no longer exists; size+mtime for very large files). */
export async function fingerprintFile(absPath: string): Promise<string> {
  try {
    const info = await stat(absPath);
    if (!info.isFile()) return "not-a-file";
    if (info.size > HASH_LIMIT_BYTES) return `large:${info.size}:${Math.floor(info.mtimeMs)}`;
    const data = await readFile(absPath);
    return createHash("sha1").update(data).digest("hex");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "deleted";
    throw err;
  }
}

/** Parses `git status --porcelain=v1 -z` output into repo-root-relative paths. */
export function parsePorcelainZ(output: string): string[] {
  const tokens = output.split("\0").filter((t) => t.length > 0);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const xy = token.slice(0, 2);
    paths.push(token.slice(3));
    // Renames and copies carry the original path as the next NUL-separated token.
    if (xy.includes("R") || xy.includes("C")) {
      const source = tokens[i + 1];
      if (source !== undefined) paths.push(source);
      i++;
    }
  }
  return paths;
}

function stripPrefix(paths: string[], prefix: string): string[] {
  return paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
}

/** Files that differ from HEAD (modified, staged, deleted, renamed or untracked), with fingerprints. */
export async function dirtyFiles(
  projectDir: string,
  ctx: GitContext,
  isIgnored: (path: string) => boolean,
): Promise<FileMap | undefined> {
  const status = await git(projectDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (status === undefined) return undefined;
  const files: FileMap = {};
  for (const rel of stripPrefix(parsePorcelainZ(status), ctx.prefix)) {
    if (rel === "" || isIgnored(rel)) continue;
    files[rel] = await fingerprintFile(join(projectDir, rel));
  }
  return files;
}

/** Project files changed between two commits, or undefined when either commit is unknown. */
export async function changedBetweenCommits(
  projectDir: string,
  ctx: GitContext,
  from: string,
  to: string,
): Promise<string[] | undefined> {
  const out = await git(projectDir, ["diff", "--name-only", "-z", from, to, "--", "."]);
  if (out === undefined) return undefined;
  return stripPrefix(out.split("\0").filter(Boolean), ctx.prefix);
}
