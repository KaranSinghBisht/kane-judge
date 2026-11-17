import type { KaneResults } from "./results.js";
import { flowFor } from "./scorecard.js";
import type { Verdict } from "./verdict.js";

/**
 * Enforces "evidence or it didn't happen" in code, not just in the judge's
 * instructions: a claim is `proven` only when its Kane flow's latest run
 * passed, and `broken` only when Kane actually ran a flow for it.
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
    }
  });
  return errors;
}
