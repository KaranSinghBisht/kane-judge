import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeMessage } from "../shared/errors.js";
import { relativeInside } from "../shared/fs.js";
import { log } from "../shared/logger.js";
import { runCommand } from "../shared/proc.js";

/**
 * Kane's own verdict on a run. After every run Kane Judge hands the sealed
 * evidence pack to `kane-cli evidence verdict` with the policy below, so the
 * pass/fail a scorecard shows was recomputed from the pack by Kane's verdict
 * engine (no AI, no credits), not asserted by the judge.
 */
export const CLAIMS_POLICY_ID = "kane-judge-claims";

/** Kept identical to policies/claims.yaml (a test compares them). */
export const CLAIMS_POLICY = `# Kane Judge's gate on a run's sealed Kane evidence pack.
# Kane's own verdict engine judges it (no AI, no credits):
#   kane-cli evidence verdict <pack> --policy policies/claims.yaml
# A flow is one claim, so "no failed flows" means every claim Kane tested held up,
# and a flow that passed without a single assert step proves nothing.
policy: kane-judge-claims
gates:
  - { id: no-failed-flows, metric: totals.failed, equals: 0, severity: blocking }
  - { id: no-unjudged-flows, metric: totals.broken, equals: 0, severity: blocking }
  - { id: no-skipped-flows, metric: totals.skipped, equals: 0, severity: blocking }
  - { id: every-passed-flow-has-checks, metric: metrics.tests_without_checks, where: "test.status == 'passed'", equals: 0, severity: blocking }
  - { id: nothing-flaky, metric: metrics.flaky_rate, max: 0, severity: warning }
  - { id: no-exhausted-heals, metric: metrics.heal.exhausted_tests, equals: 0, severity: warning }
`;

export interface PolicyGate {
  id: string;
  metric?: string;
  /** pass | fail | error, as Kane reports it. */
  status: string;
  severity?: string;
  expected?: string;
  actual?: string;
}

export interface KanePolicyVerdict {
  policy: string;
  /** pass | fail | error, as Kane reports it. */
  result: string;
  gates: PolicyGate[];
  failedGates: string[];
  warnings: string[];
  erroredGates: string[];
  /** sha256 of the sealed evidence pack Kane judged. */
  packSha256?: string;
  policySha256?: string;
  evaluator?: string;
  /** Kane's verdict document (project-relative when it is inside the project). */
  file?: string;
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const shown = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : typeof v === "object" ? JSON.stringify(v) : String(v));

function readGate(raw: unknown): PolicyGate | undefined {
  const g = asObject(raw);
  const id = str(g?.id);
  if (!g || !id) return undefined;
  return { id, metric: str(g.metric), status: str(g.status) ?? "?", severity: str(g.severity), expected: shown(g.expected), actual: shown(g.actual) };
}

function firstJsonObject(stdout: string): Json | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = asObject(JSON.parse(line) as unknown);
      if (parsed && Array.isArray(parsed.verdicts)) return parsed;
    } catch {
      // Not the verdict line; keep looking.
    }
  }
  return undefined;
}

/** Reads the `--json` output of `kane-cli evidence verdict` for one policy. */
export function parsePolicyVerdict(stdout: string, policyId: string = CLAIMS_POLICY_ID): KanePolicyVerdict | undefined {
  const doc = firstJsonObject(stdout);
  const verdicts = (Array.isArray(doc?.verdicts) ? doc.verdicts : []).map(asObject).filter((v): v is Json => v !== undefined);
  const verdict = verdicts.find((v) => str(asObject(v.policy)?.id) === policyId);
  const result = str(verdict?.result);
  if (!verdict || !result || !["pass", "fail", "error"].includes(result)) return undefined;
  const listed = (Array.isArray(doc?.policies) ? doc.policies : []).map(asObject).find((p) => str(p?.id) === policyId);
  return {
    policy: str(asObject(verdict.policy)?.id) ?? policyId,
    result,
    gates: (Array.isArray(verdict.gates) ? verdict.gates : []).map(readGate).filter((g): g is PolicyGate => g !== undefined),
    failedGates: strings(verdict.failed_gates),
    warnings: strings(verdict.warnings),
    erroredGates: strings(verdict.errored_gates),
    packSha256: str(asObject(verdict.pack)?.sha256),
    policySha256: str(asObject(verdict.policy)?.sha256),
    evaluator: str(verdict.evaluator),
    file: str(listed?.file),
  };
}

export interface JudgePackOptions {
  kaneBin: string;
  projectDir: string;
  /** The sealed evidence pack of the run to judge. */
  packPath: string;
}

/**
 * Has Kane judge a sealed evidence pack against the claims policy. Returns
 * undefined (and logs why) when this Kane CLI can't do it; a run's results
 * never depend on it.
 */
export async function judgePack(opts: JudgePackOptions): Promise<KanePolicyVerdict | undefined> {
  const policyPath = join(opts.projectDir, ".kane-judge", `${CLAIMS_POLICY_ID}.policy.yaml`);
  try {
    await mkdir(dirname(policyPath), { recursive: true });
    await writeFile(policyPath, CLAIMS_POLICY, "utf8");
  } catch (err) {
    log.warn(`could not write the Kane policy file: ${safeMessage(err)}`);
    return undefined;
  }
  const args = ["evidence", "verdict", opts.packPath, "--policy", policyPath, "--json"];
  const result = await runCommand(opts.kaneBin, args, { cwd: opts.projectDir, timeoutMs: 60_000, killGraceMs: 2_000 });
  const verdict = result.spawnError || result.timedOut ? undefined : parsePolicyVerdict(result.stdout);
  if (!verdict) {
    log.warn(`Kane gave no policy verdict for ${opts.packPath} (exit ${result.exitCode ?? "none"}${result.timedOut ? ", timed out" : ""})`);
    return undefined;
  }
  return { ...verdict, file: verdict.file ? (relativeInside(opts.projectDir, verdict.file) ?? verdict.file) : undefined };
}

/** "PASS (6 gates)" or "FAIL: no-failed-flows (totals.failed is 2, expected 0)". */
export function describePolicyVerdict(verdict: KanePolicyVerdict): string {
  const label = verdict.result.toUpperCase();
  const problems = verdict.gates
    .filter((g) => g.status !== "pass")
    .map((g) => `${g.id} (${g.metric ?? "gate"} is ${g.actual ?? "unknown"}${g.expected !== undefined ? `, expected ${g.expected}` : ""}${g.severity === "warning" ? ", warning" : ""})`);
  if (problems.length === 0) return `${label} (${verdict.gates.length} gate${verdict.gates.length === 1 ? "" : "s"})`;
  return `${label}: ${problems.join("; ")}`;
}
