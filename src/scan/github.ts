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

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Commits on the ref's branch, limited to the ref's folder when it names one. */
async function readCommits(base: string, ref: RepoRef): Promise<{ items: CommitItem[]; complete: boolean }> {
  const items: CommitItem[] = [];
  const scope = `${ref.path ? `&path=${encodeURIComponent(ref.path)}` : ""}${ref.ref ? `&sha=${encodeURIComponent(ref.ref)}` : ""}`;
  for (let page = 1; page <= COMMIT_PAGES; page++) {
    const list = await githubApi(`${base}/commits?per_page=100&page=${page}${scope}`);
    if (!Array.isArray(list)) return { items, complete: false };
    items.push(...list.map(readCommit).filter((c): c is CommitItem => c !== undefined));
    if (list.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The event window as timestamps. A plain date (2026-11-19) covers that whole
 * day in every timezone, from its start in UTC+14 to its end in UTC-12, so
 * nobody is reported as early or late because of where they live. Pass a full
 * timestamp (2026-11-19T23:59:00+05:30) for an exact deadline.
 */
export function windowBounds(window?: EventWindow): { since: number; until: number } {
  const start = window?.since ? Date.parse(DATE_ONLY.test(window.since) ? `${window.since}T00:00:00+14:00` : window.since) : -Infinity;
  const end = window?.until ? Date.parse(DATE_ONLY.test(window.until) ? `${window.until}T23:59:59.999-12:00` : window.until) : Infinity;
  return { since: Number.isNaN(start) ? -Infinity : start, until: Number.isNaN(end) ? Infinity : end };
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
  const { since, until } = windowBounds(window);
  const times = items.map((c) => Date.parse(c.date));
  return {
    ...facts,
    beforeWindow: times.filter((t) => t < since).length,
    inWindow: times.filter((t) => t >= since && t <= until).length,
    afterWindow: times.filter((t) => t > until).length,
  };
}

/** The README of the repo, or of the ref's folder when it names one. */
async function readReadme(base: string, ref: RepoRef): Promise<string | undefined> {
  const where = `${ref.path ? `/${encodePath(ref.path)}` : ""}${ref.ref ? `?ref=${encodeURIComponent(ref.ref)}` : ""}`;
  const doc = asObject(await githubApi(`${base}/readme${where}`));
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

/**
 * Reads repo metadata, languages, commit history and README. Never clones or runs anything.
 * For a subfolder submission (a /tree/<branch>/<folder> URL) the README and the commit
 * history are the folder's own.
 */
export async function scanRepo(ref: RepoRef, window?: EventWindow): Promise<RepoScan> {
  const base = `repos/${ref.owner}/${ref.repo}`;
  const meta = asObject(await githubApi(base));
  if (!meta) return unreadable(ref);
  // A parent repo's description, homepage, topics and languages say nothing about a subfolder submission.
  const [languages, readme, commits] = await Promise.all([ref.path ? undefined : githubApi(`${base}/languages`), readReadme(base, ref), readCommits(base, ref)]);
  const repoName = str(meta.full_name) ?? `${ref.owner}/${ref.repo}`;
  const facts: RepoFacts = {
    fullName: ref.path ? `${repoName}/${ref.path}` : repoName,
    url: ref.path ? ref.url : (str(meta.html_url) ?? ref.url),
    path: ref.path,
    description: ref.path ? undefined : str(meta.description),
    homepage: ref.path ? undefined : str(meta.homepage),
    createdAt: str(meta.created_at),
    pushedAt: str(meta.pushed_at),
    defaultBranch: str(meta.default_branch),
    stars: num(meta.stargazers_count),
    forks: num(meta.forks_count),
    license: str(asObject(meta.license)?.spdx_id),
    topics: !ref.path && Array.isArray(meta.topics) ? meta.topics.filter((t): t is string => typeof t === "string") : [],
    languages: ref.path ? {} : languagesOf(languages),
    commits: commitFacts(commits.items, commits.complete, window),
    readmeChars: readme?.length,
    error: ref.path && !readme && commits.items.length === 0 ? `nothing found at ${ref.path} on ${ref.ref ?? "the default branch"}: check the folder and branch` : undefined,
  };
  return { facts, readme };
}
