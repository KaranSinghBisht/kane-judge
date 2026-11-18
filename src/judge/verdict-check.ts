import {
  CLAIM_STATUSES,
  VERDICT_MODES,
  type ClaimFix,
  type ClaimStatus,
  type InvestigationStep,
  type Verdict,
  type VerdictCheck,
  type VerdictClaim,
  type VerdictMode,
  type VerdictScore,
} from "./verdict.js";

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

function readFix(raw: unknown, where: string, p: Problems): ClaimFix | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    p.add(where, '"fix" must be an object like { "summary": "...", "files": ["..."] }');
    return undefined;
  }
  const files = raw.files === undefined ? [] : raw.files;
  if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) p.add(`${where}.fix`, '"files" must be an array of project file paths');
  const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim()) : [];
  return { summary: requireText(raw, "summary", `${where}.fix`, p), files: list };
}

/** A judge never changes the project it judges; only a builder's pre-flight can fix or withdraw a claim. */
function checkFixRules(claim: VerdictClaim, mode: VerdictMode, where: string, p: Problems): void {
  if (claim.fix && mode !== "preflight") p.add(where, '"fix" is only allowed in pre-flight mode ("mode": "preflight"): a judge never changes the project it judges');
  if (claim.fix && claim.status !== "proven" && claim.status !== "broken" && claim.status !== "withdrawn") {
    p.add(where, `"fix" doesn't fit status "${claim.status}": a fixed claim is proven (Kane passed), still broken, or withdrawn`);
  }
  if (claim.status !== "withdrawn") return;
  if (mode !== "preflight") p.add(where, 'only the builder can withdraw a claim: "withdrawn" needs "mode": "preflight"');
  if (!claim.fix) p.add(where, '"withdrawn" needs "fix": say where the claim was removed from the submission');
}

function readClaim(raw: unknown, i: number, p: Problems, mode: VerdictMode): VerdictClaim | undefined {
  const where = `claims[${i}]`;
  if (!isObject(raw)) {
    p.add(where, "must be an object");
    return undefined;
  }
  const status = raw.status as ClaimStatus;
  if (!CLAIM_STATUSES.includes(status)) p.add(where, `"status" must be one of ${CLAIM_STATUSES.join(", ")}`);
  const claim: VerdictClaim = {
    id: text(raw.id) ?? `c${i + 1}`,
    claim: requireText(raw, "claim", where, p),
    source: requireText(raw, "source", where, p),
    flow: text(raw.flow),
    status,
    evidence: requireText(raw, "evidence", where, p),
    investigation: readSteps(raw.investigation, where, p),
    fix: readFix(raw.fix, where, p),
  };
  checkFixRules(claim, mode, where, p);
  return claim;
}

function readMode(raw: unknown, p: Problems): VerdictMode {
  if (raw === undefined) return "judge";
  if (VERDICT_MODES.includes(raw as VerdictMode)) return raw as VerdictMode;
  p.add("mode", `must be one of ${VERDICT_MODES.join(", ")}`);
  return "judge";
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
  const mode = readMode(raw.mode, p);
  const verdict: Verdict = {
    version: 1,
    mode,
    project: {
      name: requireText(project, "name", "project", p),
      slug: requireText(project, "slug", "project", p),
      repo: text(project.repo),
      live: text(project.live),
      submission: text(project.submission),
      video: text(project.video),
    },
    summary: requireText(raw, "summary", "verdict", p),
    claims: readList(raw.claims, "claims", (v, i, problems) => readClaim(v, i, problems, mode), p),
    scores: readList(raw.scores, "scores", readScore, p),
    questions: readStrings(raw.questions, "questions", p),
    flags: readStrings(raw.flags, "flags", p),
    judgedAt: text(raw.judgedAt),
    rubric: text(raw.rubric),
  };
  return p.list.length ? { ok: false, errors: p.list } : { ok: true, verdict };
}
