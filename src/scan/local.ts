import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { runCommand } from "../shared/proc.js";
import { commitFacts, type EventWindow, type RepoScan } from "./github.js";

const README_NAMES = ["README.md", "Readme.md", "readme.md", "README.markdown", "README"];
const README_LIMIT = 60_000;
const MAX_COMMITS = 1000;

/** True for an existing local directory (pre-flight mode: judge your own checkout before you push). */
export function isLocalDir(input: string): boolean {
  try {
    return existsSync(input) && statSync(input).isDirectory();
  } catch {
    return false;
  }
}

export async function readLocalReadme(dir: string): Promise<string | undefined> {
  for (const name of README_NAMES) {
    try {
      return (await readFile(join(dir, name), "utf8")).slice(0, README_LIMIT);
    } catch {
      // Try the next common README name.
    }
  }
  return undefined;
}

async function localCommits(dir: string): Promise<{ items: Array<{ date: string; author: string }>; complete: boolean }> {
  // Never let a repository's own config run programs (signature checks, fsmonitor, pagers).
  const safe = ["-c", "gpg.program=false", "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-C", dir];
  const opts = { cwd: dir, timeoutMs: 30_000, killGraceMs: 2_000 };
  const result = await runCommand("git", [...safe, "log", "--no-show-signature", "--format=%aI%x09%an", "-n", String(MAX_COMMITS), "--", "."], opts);
  if (result.spawnError || result.exitCode !== 0) return { items: [], complete: false };
  const shallow = await runCommand("git", [...safe, "rev-parse", "--is-shallow-repository"], opts);
  const items = result.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts): parts is [string, string] => parts.length === 2 && parts[0] !== "")
    .map(([date, author]) => ({ date, author }));
  return { items, complete: items.length < MAX_COMMITS && shallow.stdout.trim() !== "true" };
}

/** Reads a local checkout: its README and git history. Like the GitHub scan, it runs none of the project's code. */
export async function scanLocal(dir: string, window?: EventWindow): Promise<RepoScan> {
  const abs = resolve(dir);
  const [readme, commits] = await Promise.all([readLocalReadme(abs), localCommits(abs)]);
  const facts = commitFacts(commits.items, commits.complete, window);
  return {
    facts: {
      fullName: basename(abs),
      url: abs,
      createdAt: facts.first,
      topics: [],
      languages: {},
      commits: facts,
      readmeChars: readme?.length,
      error: commits.items.length === 0 ? "no git history found in this folder" : undefined,
    },
    readme,
  };
}
