import { fixProof, flowVersions, type KaneResults } from "./results.js";
import { flowFor } from "./scorecard.js";
import type { Verdict } from "./verdict.js";

/** A flow may be rewritten twice (three texts in all) and still prove a claim. */
export const MAX_FLOW_VERSIONS = 3;

/**
 * Enforces "evidence or it didn't happen" in code, not just in the judge's
 * instructions:
 * - a claim is `proven` only when its Kane flow's latest run passed and really
 *   ran steps, and the flow was rewritten at most twice on the way (no bending
 *   a test until it passes);
 * - a claim is `broken` only when Kane's latest run of its flow failed;
 * - a pre-flight fix counts only when Kane saw the very same flow fail and
 *   then pass, so a fix can never be a test that was edited until it passed.
 */
export function checkAgainstKane(verdict: Verdict, results?: KaneResults): string[] {
  const errors: string[] = [];
  verdict.claims.forEach((claim, i) => {
    if (claim.status !== "proven" && claim.status !== "broken") return;
    const where = `claims[${i}] (${claim.id})`;
    if (!claim.flow) {
      errors.push(`${where}: "${claim.status}" needs the Kane flow behind it in "flow" (or mark it unverifiable / untested)`);
      return;
    }
    const flow = flowFor(claim, results);
    if (!flow) {
      errors.push(`${where}: Kane has no result for ${claim.flow}; run it with \`kane-judge run\` first`);
      return;
    }
    if (claim.status === "proven" && flow.status !== "passed") {
      errors.push(`${where}: marked proven, but Kane's latest run of ${flow.name} ${flow.status}. A claim is proven only when its Kane flow passed.`);
      return;
    }
    if (claim.status === "proven" && flow.steps.length === 0) {
      errors.push(`${where}: marked proven, but Kane's record of ${flow.name} shows no steps were run. A pass that checked nothing proves nothing: give the flow \`## \` steps with checks and re-run it.`);
      return;
    }
    if (claim.status === "broken" && flow.status === "passed") {
      errors.push(`${where}: marked broken, but Kane's latest run of ${flow.name} passed. A claim is broken only when Kane shows it failing: tighten the flow's check and re-run it, or mark the claim proven.`);
      return;
    }
    if (claim.status === "proven" && flowVersions(flow) > MAX_FLOW_VERSIONS) {
      errors.push(`${where}: ${flow.name} was rewritten ${flowVersions(flow) - 1} times before it passed; the limit is ${MAX_FLOW_VERSIONS - 1}. Mark the claim unverifiable and say what Kane saw.`);
      return;
    }
    if (claim.status === "proven" && claim.fix && !fixProof(flow)) {
      errors.push(
        `${where}: a fix is recorded, but Kane's history for ${flow.name} doesn't show the same test failing and then passing. A fix counts only when the flow that failed passes unchanged: restore the flow's text and re-run it, or remove "fix" and report the claim as proven.`,
      );
    }
  });
  return errors;
}
