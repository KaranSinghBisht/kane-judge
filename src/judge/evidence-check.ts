import type { ScanResult } from "../scan/types.js";
import { claimRuns, fixProof, flowVersions, type FlowResult, type KaneResults } from "./results.js";
import { flowFor } from "./scorecard.js";
import type { Verdict, VerdictClaim } from "./verdict.js";

/** A flow may be rewritten twice (three texts in all) and still prove a claim. */
export const MAX_FLOW_VERSIONS = 3;

const where = (claim: VerdictClaim, i: number) => `claims[${i}] (${claim.id})`;

/**
 * The mode is a fact about how the project was scanned, written by `kane-judge
 * scan`, not something a verdict can declare for itself. Only a project scanned
 * from the builder's own folder with `--preflight` may record fixes or withdraw claims.
 */
export function checkMode(verdict: Verdict, scan?: ScanResult): string[] {
  const scanned = scan?.mode ?? "judge";
  const claimed = verdict.mode ?? "judge";
  if (claimed === scanned) return [];
  if (claimed === "preflight") {
    return [
      `"mode": "preflight" doesn't match the scan, which recorded this project as judged. Pre-flight is for the builder's own folder: scan it with \`kane-judge scan <folder> --live <url> --preflight\`. A judge never fixes or withdraws another project's claims.`,
    ];
  }
  return [`this project was scanned for pre-flight, so verdict.json needs "mode": "preflight"`];
}

/** A claim's flow belongs to that claim alone, and every claim Kane tested has to be in the verdict. */
function checkBinding(verdict: Verdict, results: KaneResults): string[] {
  const errors: string[] = [];
  const owner = new Map<string, string>();
  verdict.claims.forEach((claim, i) => {
    const flow = flowFor(claim, results);
    if (!flow) return;
    const other = owner.get(flow.name);
    if (other) errors.push(`${where(claim, i)}: ${flow.name} already backs claim ${other}. One Kane flow tests one claim.`);
    owner.set(flow.name, claim.id);
    if (flow.claim && flow.claim !== claim.id.toLowerCase()) {
      errors.push(`${where(claim, i)}: points at ${flow.name}, which Kane ran as the flow for claim ${flow.claim}. A claim can only be backed by its own flow.`);
    }
    const latest = claimRuns(results, flow).pop();
    if (latest && latest.flow !== flow.name) {
      errors.push(`${where(claim, i)}: points at ${flow.name}, but Kane's latest run for claim ${flow.claim ?? claim.id} was ${latest.flow}. A claim stands on its latest Kane run.`);
    }
  });
  const ids = new Set(verdict.claims.map((claim) => claim.id.toLowerCase()));
  for (const flow of Object.values(results.flows)) {
    if (flow.claim && !ids.has(flow.claim)) {
      errors.push(`Kane ran ${flow.name} for claim ${flow.claim}, but the verdict has no claim ${flow.claim}. A claim Kane tested can't be left out.`);
    }
  }
  return errors;
}

function checkProven(claim: VerdictClaim, flow: FlowResult, results: KaneResults, at: string, judging: boolean): string | undefined {
  if (flow.status !== "passed") {
    return `${at}: marked proven, but Kane's latest run of ${flow.name} ${flow.status}. A claim is proven only when its Kane flow passed.`;
  }
  if (flow.steps.length === 0) {
    return `${at}: marked proven, but Kane's record of ${flow.name} shows no steps were run. A pass that checked nothing proves nothing: give the flow \`## \` steps with checks and re-run it.`;
  }
  if (!flow.asserts) {
    return `${at}: marked proven, but Kane's evidence pack for ${flow.name} could not be read when it ran, so no passed assert step is on record. Run the flow again.`;
  }
  if (flow.asserts.passed < 1) {
    return `${at}: marked proven, but Kane's evidence for ${flow.name} holds no passed assert step. A pass that asserted nothing proves nothing: end each step with a "Verify …" sentence and re-run it.`;
  }
  if (judging && flow.startUrl) {
    return `${at}: ${flow.name} last passed against ${flow.startUrl}, not the submission's own demo. A judge proves a claim on the demo the team submitted: re-run it without --start-url.`;
  }
  if (flowVersions(results, flow) > MAX_FLOW_VERSIONS) {
    return `${at}: the flow for this claim was rewritten ${flowVersions(results, flow) - 1} times before it passed; the limit is ${MAX_FLOW_VERSIONS - 1}. Mark the claim unverifiable and say what Kane saw.`;
  }
  const originalChecks = claimRuns(results, flow).find(r => r.checksSha)?.checksSha;
  if (originalChecks && flow.checksSha && originalChecks !== flow.checksSha) {
    return `${at}: the claim's checks changed after its first Kane run. A test rewrite may change the route, not weaken what is asserted. Restore the original checks and re-run, or mark the claim unverifiable.`;
  }
  if (claim.fix && !fixProof(results, flow)) {
    return `${at}: a fix is recorded, but Kane's history for this claim doesn't show the same test failing and then passing. A fix counts only when the flow that showed the claim broken passes unchanged: restore that flow's text and re-run it, or remove "fix" and report the claim as proven.`;
  }
  return undefined;
}

/**
 * Enforces "evidence or it didn't happen" against Kane's recorded results:
 * - a flow backs exactly one claim, the one Kane ran it for, and no tested claim is dropped;
 * - `proven` needs a latest run that passed, ran steps and passed at least one assert,
 *   on the submission's own demo, after at most two rewrites of the claim's flow;
 * - `broken` needs a latest run that failed;
 * - a pre-flight fix needs the flow that showed the claim broken to pass unchanged.
 */
export function checkAgainstKane(verdict: Verdict, results?: KaneResults): string[] {
  const errors: string[] = results ? checkBinding(verdict, results) : [];
  const judging = (verdict.mode ?? "judge") === "judge";
  verdict.claims.forEach((claim, i) => {
    if (claim.status !== "proven" && claim.status !== "broken") return;
    const at = where(claim, i);
    if (!claim.flow) {
      errors.push(`${at}: "${claim.status}" needs the Kane flow behind it in "flow" (or mark it unverifiable / untested)`);
      return;
    }
    const flow = flowFor(claim, results);
    if (!flow || !results) {
      errors.push(`${at}: Kane has no result for ${claim.flow}; run it with \`kane-judge run\` first`);
      return;
    }
    const attempted = [...results.runs].reverse().find(r => r.flows.includes(flow.name));
    if (attempted?.outcome === "error" || attempted?.outcome === "timeout") {
      errors.push(`${at}: the latest attempt of ${flow.name} ended with ${attempted.outcome}, so an earlier result cannot establish its current status. Re-run it or mark the claim unverifiable.`);
      return;
    }
    if (claim.status === "broken") {
      if (flow.status === "passed") {
        errors.push(`${at}: marked broken, but Kane's latest run of ${flow.name} passed. A claim is broken only when Kane shows it failing: tighten the flow's check and re-run it, or mark the claim proven.`);
      } else if (flow.status !== "failed") {
        errors.push(`${at}: marked broken, but Kane reported ${flow.status}, not a failed product check. Mark the claim unverifiable until a completed test shows it failing.`);
      }
      return;
    }
    const problem = checkProven(claim, flow, results, at, judging);
    if (problem) errors.push(problem);
  });
  return errors;
}

const QUOTED = /["“]([^"”]+)["”]/;
const plain = (text: string) => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A withdrawn claim has to be gone from the builder's README: if the words the
 * claim quotes are still there, the promise still stands.
 */
export function checkWithdrawn(verdict: Verdict, readme: string | undefined, original: string | undefined): string[] {
  const text = readme === undefined ? undefined : plain(readme);
  return verdict.claims.flatMap((claim, i) => {
    if (claim.status !== "withdrawn") return [];
    const quote = QUOTED.exec(claim.source)?.[1];
    if (!quote || !plain(quote)) return [`${where(claim, i)}: quote the exact withdrawn promise in its source so it can be checked against the README.`];
    if (text === undefined) return [`${where(claim, i)}: the current README is missing. Restore it or include README.after.md in the shared project to verify the withdrawal.`];
    if (original === undefined || !plain(original).includes(plain(quote))) return [`${where(claim, i)}: the quoted promise must appear in the original scanned README to verify a withdrawal.`];
    if (!text.includes(plain(quote))) return [];
    return [`${where(claim, i)}: marked withdrawn, but the README still says "${quote.slice(0, 80)}${quote.length > 80 ? "…" : ""}". Take the promise out of the README first.`];
  });
}

/**
 * The denominator. Kane itself read the README and listed the use-cases it
 * promises; every one has to be covered by a claim, tested or not, so a verdict
 * can't quietly leave out the promises that would not hold.
 */
export function checkCoverage(verdict: Verdict, scan?: ScanResult): string[] {
  const useCases = scan?.useCases ?? [];
  if (useCases.length === 0) return [];
  const known = new Set(useCases.map((u) => u.id));
  const covered = new Set(verdict.claims.flatMap((claim) => claim.covers ?? []));
  const errors = verdict.claims.flatMap((claim, i) =>
    (claim.covers ?? []).filter((id) => !known.has(id)).map((id) => `${where(claim, i)}: "covers" names ${id}, which is not a use-case in the scan (${useCases.map((u) => u.id).join(", ")})`),
  );
  for (const useCase of useCases) {
    if (covered.has(useCase.id)) continue;
    errors.push(
      `Kane found use-case ${useCase.id} "${useCase.title}" in the README${useCase.anchor ? ` (${useCase.anchor})` : ""}, and no claim covers it. Add ${useCase.id} to a claim's "covers": a tested claim, or one marked "untested" or "unverifiable" with the reason.`,
    );
  }
  return errors;
}

/**
 * A score is a judgement, so it has to show its evidence: the "why" cites the
 * claims it rests on, or "unverified" says what could not be checked. The same
 * rule a human judging form would ask for.
 */
export function checkScoreEvidence(verdict: Verdict): string[] {
  const ids = new Set(verdict.claims.map((claim) => claim.id.toLowerCase()));
  return verdict.scores.flatMap((score, i) => {
    const cited = (score.why.match(/\bc\d+\b/gi) ?? []).map((id) => id.toLowerCase());
    const unknown = cited.filter(id => !ids.has(id));
    if (unknown.length) return [`scores[${i}] (${score.criterion}): the score cites unknown claims ${[...new Set(unknown)].join(", ")}.`];
    if (cited.length || score.unverified) return [];
    return [`scores[${i}] (${score.criterion}): cite the claims this score rests on in "why" (for example "c1 and c2 proven, c3 broken"), or say what you couldn't verify in "unverified".`];
  });
}
