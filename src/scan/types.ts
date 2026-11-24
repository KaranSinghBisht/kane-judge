/** scan.json: facts about a submission, gathered without running any of its code. */
export interface CommitFacts {
  /** Commits read (the API is paged; very large histories are sampled from the newest end). */
  sampled: number;
  /** True when every commit was read, so `first` is the real first commit. */
  complete: boolean;
  first?: string;
  last?: string;
  authors: string[];
  /** Counts relative to the event window, when one was given. */
  beforeWindow?: number;
  inWindow?: number;
  afterWindow?: number;
}

export interface RepoFacts {
  /** "owner/repo", plus the folder for a subfolder submission. */
  fullName: string;
  url: string;
  /** Folder inside the repo that holds the submission, when it isn't the repo root. */
  path?: string;
  description?: string;
  homepage?: string;
  createdAt?: string;
  pushedAt?: string;
  defaultBranch?: string;
  stars?: number;
  forks?: number;
  license?: string;
  topics: string[];
  /** Bytes of code per language, as GitHub reports it. */
  languages: Record<string, number>;
  commits: CommitFacts;
  readmeChars?: number;
  /** Set when the repo could not be read (private, missing, rate-limited). */
  error?: string;
}

export interface PageFacts {
  url: string;
  status: number;
  title?: string;
  chars: number;
}

import type { KaneUseCase } from "../kane/usecases.js";

export interface ScanResult {
  version: 1;
  /** The use-cases Kane itself found in the README: the denominator every verdict has to account for. */
  useCases?: KaneUseCase[];
  /** Why there is no use-case list, when Kane could not be asked. */
  useCasesNote?: string;
  /**
   * `preflight` only when the builder scanned their own folder with --preflight.
   * `report` holds the verdict to this, so a verdict can't declare itself a pre-flight.
   */
  mode?: "judge" | "preflight";
  scannedAt: string;
  slug: string;
  name: string;
  inputs: string[];
  /** The live demo Kane will use. */
  live?: string;
  /** HTTP status of the live demo when probed (0 = unreachable). */
  liveStatus?: number;
  /** Other links that look like a deployed demo. */
  demoCandidates: string[];
  repos: RepoFacts[];
  videos: string[];
  window?: { since?: string; until?: string };
  /** Text in the submission that tries to instruct an AI judge. Always a red flag. */
  injectionHints: string[];
  pages: PageFacts[];
}

/** Runtime validation before scan data controls mode, coverage, or report rendering. */
export function isScanResult(value: unknown): value is ScanResult {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const strings = (v: unknown) => Array.isArray(v) && v.every(s => typeof s === "string");
  if (!object(value) || value.version !== 1 || typeof value.scannedAt !== "string" || typeof value.slug !== "string" || typeof value.name !== "string") return false;
  if (value.mode !== undefined && value.mode !== "judge" && value.mode !== "preflight") return false;
  if (![value.inputs, value.demoCandidates, value.videos, value.injectionHints].every(strings)) return false;
  if (!Array.isArray(value.repos) || !value.repos.every(r => object(r) && typeof r.url === "string" && object(r.commits) && strings(r.commits.authors) && Array.isArray(r.topics) && object(r.languages))) return false;
  if (!Array.isArray(value.pages) || !value.pages.every(p => object(p) && typeof p.url === "string")) return false;
  return value.useCases === undefined || (Array.isArray(value.useCases) && value.useCases.every(u => object(u) && typeof u.id === "string" && typeof u.title === "string"));
}
