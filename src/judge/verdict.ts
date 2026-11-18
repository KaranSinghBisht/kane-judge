/**
 * verdict.json: Claude's judgement of one project, grounded in Kane's results.
 * Claude writes it; `kane-judge report` validates it and renders the scorecard.
 */
export const CLAIM_STATUSES = ["proven", "broken", "unverifiable", "untested", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * `judge`: someone else's project; the judge may only fix its own tests.
 * `preflight`: the builder's own project; the agent may fix the code or the
 * README, and Kane must pass the unchanged test before a fix counts.
 */
export const VERDICT_MODES = ["judge", "preflight"] as const;
export type VerdictMode = (typeof VERDICT_MODES)[number];

/** Pre-flight only: what the builder's agent changed after Kane showed a claim broken. */
export interface ClaimFix {
  /** What was changed, in a sentence. */
  summary: string;
  /** Project files that were edited. */
  files: string[];
}

/** One round of the investigation loop for a claim: what Kane reported and what the judge did next. */
export interface InvestigationStep {
  round: number;
  /** What Kane reported, in a sentence (e.g. "failed at step 2: no Share button"). */
  kane: string;
  /** What the judge concluded or changed (e.g. "README is outdated; rewrote the flow to use the menu"). */
  action: string;
}

export interface VerdictClaim {
  id: string;
  /** The claim as a user would put it: "You can create a poll and vote on it". */
  claim: string;
  /** Where the submission makes the claim, quoted. */
  source: string;
  /** Project-relative flow file that tested it, when one did. */
  flow?: string;
  status: ClaimStatus;
  /** The evidence behind the status, in one or two sentences. */
  evidence: string;
  investigation?: InvestigationStep[];
  /** Pre-flight only: the change made after Kane showed the claim broken. */
  fix?: ClaimFix;
  /** The use-cases Kane found in the README that this claim accounts for (u1, u2, … from the scan). */
  covers?: string[];
}

export interface VerdictScore {
  criterion: string;
  score: number;
  max: number;
  /** The evidence behind the score. It has to cite the claims it rests on (c1, c3, …). */
  why: string;
  /** What could not be verified for this criterion. Stands in for cited claims when there are none to cite. */
  unverified?: string;
}

export interface VerdictProject {
  name: string;
  slug: string;
  repo?: string;
  live?: string;
  submission?: string;
  video?: string;
}

export interface Verdict {
  version: 1;
  /** Defaults to `judge`. */
  mode?: VerdictMode;
  project: VerdictProject;
  /** Two or three sentences a judge reads first. */
  summary: string;
  claims: VerdictClaim[];
  scores: VerdictScore[];
  /** Questions for the human judges to ask the team, each tied to evidence. */
  questions: string[];
  /** Red flags: built before the event, stubbed features, prompt injection aimed at the judge, ... */
  flags: string[];
  judgedAt?: string;
  rubric?: string;
}

export type VerdictCheck = { ok: true; verdict: Verdict } | { ok: false; errors: string[] };
