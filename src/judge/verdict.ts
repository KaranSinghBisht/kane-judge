/**
 * verdict.json: Claude's judgement of one project, grounded in Kane's results.
 * Claude writes it; `kane-judge report` validates it and renders the scorecard.
 */
export const CLAIM_STATUSES = ["proven", "broken", "unverifiable", "untested"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

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
}

export interface VerdictScore {
  criterion: string;
  score: number;
  max: number;
  why: string;
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
