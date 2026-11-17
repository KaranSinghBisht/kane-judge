import { CLAIM_STATUSES, type ClaimStatus, type InvestigationStep, type Verdict, type VerdictCheck, type VerdictClaim, type VerdictScore } from "./verdict.js";

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

class Problems {
  readonly list: string[] = [];
  add(where: string, message: string): void {
    if (this.list.length < 40) this.list.push(`${where}: ${message}`);
  }
}

function requireText(raw: Raw, key: string, where: string, p: Problems): string {
  const value = text(raw[key]);
  if (!value) p.add(where, `"${key}" must be a non-empty string`);
  return value ?? "";
}

function readSteps(raw: unknown, where: string, p: Problems): InvestigationStep[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    p.add(where, '"investigation" must be an array');
    return undefined;
  }
  return raw.flatMap((step, i) => {
    if (!isObject(step)) {
      p.add(`${where}.investigation[${i}]`, "must be an object");
      return [];
    }
    const round = typeof step.round === "number" && Number.isInteger(step.round) ? step.round : i + 1;
    return [{ round, kane: requireText(step, "kane", `${where}.investigation[${i}]`, p), action: requireText(step, "action", `${where}.investigation[${i}]`, p) }];
  });
}

function readClaim(raw: unknown, i: number, p: Problems): VerdictClaim | undefined {
  const where = `claims[${i}]`;
  if (!isObject(raw)) {
    p.add(where, "must be an object");
    return undefined;
  }
  const status = raw.status as ClaimStatus;
  if (!CLAIM_STATUSES.includes(status)) p.add(where, `"status" must be one of ${CLAIM_STATUSES.join(", ")}`);
  return {
    id: text(raw.id) ?? `c${i + 1}`,
    claim: requireText(raw, "claim", where, p),
    source: requireText(raw, "source", where, p),
    flow: text(raw.flow),
    status,
    evidence: requireText(raw, "evidence", where, p),
    investigation: readSteps(raw.investigation, where, p),
  };
}

function readScore(raw: unknown, i: number, p: Problems): VerdictScore | undefined {
  const where = `scores[${i}]`;
  if (!isObject(raw)) {
    p.add(where, "must be an object");
    return undefined;
  }
  const max = typeof raw.max === "number" && raw.max > 0 ? raw.max : 10;
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : NaN;
  if (Number.isNaN(score) || score < 0 || score > max) p.add(where, `"score" must be a number from 0 to ${max}`);
  return { criterion: requireText(raw, "criterion", where, p), score, max, why: requireText(raw, "why", where, p) };
}

function readStrings(raw: unknown, key: string, p: Problems): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) {
    p.add(key, "must be an array of strings");
    return [];
  }
  return raw.map((s: string) => s.trim()).filter(Boolean);
}

function readList<T>(raw: unknown, key: string, read: (v: unknown, i: number, p: Problems) => T | undefined, p: Problems): T[] {
  if (!Array.isArray(raw)) {
    p.add(key, "must be an array");
    return [];
  }
  return raw.map((v, i) => read(v, i, p)).filter((v): v is T => v !== undefined);
}

/** Validates a parsed verdict.json, collecting every problem so Claude can fix them in one pass. */
export function checkVerdict(raw: unknown): VerdictCheck {
  const p = new Problems();
  if (!isObject(raw)) return { ok: false, errors: ["verdict.json must contain a JSON object"] };
  const project = isObject(raw.project) ? raw.project : {};
  if (!isObject(raw.project)) p.add("project", "must be an object with at least name and slug");
  const verdict: Verdict = {
    version: 1,
    project: {
      name: requireText(project, "name", "project", p),
      slug: requireText(project, "slug", "project", p),
      repo: text(project.repo),
      live: text(project.live),
      submission: text(project.submission),
      video: text(project.video),
    },
    summary: requireText(raw, "summary", "verdict", p),
    claims: readList(raw.claims, "claims", readClaim, p),
    scores: readList(raw.scores, "scores", readScore, p),
    questions: readStrings(raw.questions, "questions", p),
    flags: readStrings(raw.flags, "flags", p),
    judgedAt: text(raw.judgedAt),
    rubric: text(raw.rubric),
  };
  return p.list.length ? { ok: false, errors: p.list } : { ok: true, verdict };
}
