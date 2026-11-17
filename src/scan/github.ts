import { runCommand } from "../shared/proc.js";
import type { RepoRef } from "./links.js";
import { USER_AGENT } from "./page.js";
import type { CommitFacts, RepoFacts } from "./types.js";

type Json = Record<string, unknown>;
export interface EventWindow {
  since?: string;
  until?: string;
}
export interface RepoScan {
  facts: RepoFacts;
  /** Raw README text (untrusted). */
  readme?: string;
}

const COMMIT_PAGES = 3;
const README_LIMIT = 60_000;

const asObject = (v: unknown): Json | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function viaGh(path: string): Promise<unknown> {
  const result = await runCommand("gh", ["api", path], { cwd: process.cwd(), timeoutMs: 30_000, killGraceMs: 2_000 });
  if (result.spawnError || result.exitCode !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return undefined;
  }
}

async function viaFetch(path: string): Promise<unknown> {
  try {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? ((await res.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** GitHub REST call: the signed-in `gh` CLI when available, otherwise the public API (60 calls/hour). */
export async function githubApi(path: string): Promise<unknown> {
  return (await viaGh(path)) ?? (await viaFetch(path));
}

interface CommitItem {
  date: string;
  author: string;
}

function readCommit(item: unknown): CommitItem | undefined {
  const o = asObject(item);
  const commit = asObject(o?.commit);
  const date = str(asObject(commit?.author)?.date) ?? str(asObject(commit?.committer)?.date);
  if (!date) return undefined;
  const author = str(asObject(o?.author)?.login) ?? str(asObject(commit?.author)?.name) ?? "unknown";
  return { date, author };
}

async function readCommits(base: string): Promise<{ items: CommitItem[]; complete: boolean }> {
  const items: CommitItem[] = [];
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    const list = await githubApi(`${base}/commits?per_page=100&page=${page}`);
    if (!Array.isArray(list)) return { items, complete: page > 1 };
    items.push(...list.map(readCommit).filter((c): c is CommitItem => c !== undefined));
    if (list.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

/** Commit dates and authors, with counts before/during/after the event window. */
export function commitFacts(items: CommitItem[], complete: boolean, window?: EventWindow): CommitFacts {
  const dates = items.map((c) => c.date).sort();
  const facts: CommitFacts = {
    sampled: items.length,
    complete,
    first: dates[0],
    last: dates[dates.length - 1],
    authors: [...new Set(items.map((c) => c.author))].slice(0, 20),
  };
  if (!window?.since && !window?.until) return facts;
  const since = window.since ? Date.parse(window.since) : -Infinity;
  const until = window.until ? Date.parse(window.until) : Infinity;
  const times = items.map((c) => Date.parse(c.date));
  return {
    ...facts,
    beforeWindow: times.filter((t) => t < since).length,
    inWindow: times.filter((t) => t >= since && t <= until).length,
    afterWindow: times.filter((t) => t > until).length,
  };
}

async function readReadme(base: string): Promise<string | undefined> {
  const doc = asObject(await githubApi(`${base}/readme`));
  const content = str(doc?.content);
  if (!content || doc?.encoding !== "base64") return undefined;
  return Buffer.from(content, "base64").toString("utf8").slice(0, README_LIMIT);
}

function languagesOf(raw: unknown): Record<string, number> {
  const o = asObject(raw) ?? {};
  return Object.fromEntries(Object.entries(o).filter((e): e is [string, number] => typeof e[1] === "number"));
}

function unreadable(ref: RepoRef): RepoScan {
  return {
    facts: {
      fullName: `${ref.owner}/${ref.repo}`,
      url: ref.url,
      topics: [],
      languages: {},
      commits: { sampled: 0, complete: false, authors: [] },
      error: "repository not readable (private, missing, or GitHub rate limit reached)",
    },
  };
}

/** Reads repo metadata, languages, commit history and README. Never clones or runs anything. */
export async function scanRepo(ref: RepoRef, window?: EventWindow): Promise<RepoScan> {
  const base = `repos/${ref.owner}/${ref.repo}`;
  const meta = asObject(await githubApi(base));
  if (!meta) return unreadable(ref);
  const [languages, readme, commits] = await Promise.all([githubApi(`${base}/languages`), readReadme(base), readCommits(base)]);
  const facts: RepoFacts = {
    fullName: str(meta.full_name) ?? `${ref.owner}/${ref.repo}`,
    url: str(meta.html_url) ?? ref.url,
    description: str(meta.description),
    homepage: str(meta.homepage),
    createdAt: str(meta.created_at),
    pushedAt: str(meta.pushed_at),
    defaultBranch: str(meta.default_branch),
    stars: num(meta.stargazers_count),
    forks: num(meta.forks_count),
    license: str(asObject(meta.license)?.spdx_id),
    topics: Array.isArray(meta.topics) ? meta.topics.filter((t): t is string => typeof t === "string") : [],
    languages: languagesOf(languages),
    commits: commitFacts(commits.items, commits.complete, window),
    readmeChars: readme?.length,
  };
  return { facts, readme };
}
