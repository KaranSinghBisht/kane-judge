import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardRows, renderBoardMarkdown } from "../src/judge/board.js";
import { checkAgainstKane } from "../src/judge/evidence-check.js";
import { renderReportMarkdown } from "../src/judge/report-md.js";
import { emptyResults, fixProof, mergeRun, type FlowResult, type KaneResults, type RunRecord } from "../src/judge/results.js";
import { claimShots, claimsInReadingOrder, headline, kaneSignOff, renderScorecard } from "../src/judge/scorecard.js";
import { formatRunSummary } from "../src/judge/summary.js";
import type { Verdict, VerdictClaim } from "../src/judge/verdict.js";
import { checkVerdict } from "../src/judge/verdict-check.js";
import { CLAIMS_POLICY, describePolicyVerdict, parsePolicyVerdict, type KanePolicyVerdict } from "../src/kane/policy.js";
import { must } from "./helpers/tmp.js";

const ROOT = join(import.meta.dirname, "..");
const FAIL_OUTPUT = readFileSync(join(import.meta.dirname, "fixtures", "policy-verdict-fail.json"), "utf8");

const PASS: KanePolicyVerdict = { policy: "kane-judge-claims", result: "pass", gates: [{ id: "no-failed-flows", status: "pass" }], failedGates: [], warnings: [], erroredGates: [], packSha256: "7c2e4ba15097cd1a" };

function claim(overrides: Partial<VerdictClaim> = {}): VerdictClaim {
  return { id: "c1", claim: "Promo codes work", source: "README", status: "proven", evidence: "Kane passed", flow: "flows/01-promo_test.md", ...overrides };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    version: 1,
    mode: "preflight",
    project: { name: "Inkwell", slug: "inkwell" },
    summary: "Fixed before submitting.",
    claims: [claim()],
    scores: [{ criterion: "Works", score: 9, max: 10, why: "all proven" }],
    questions: [],
    flags: [],
    ...overrides,
  };
}

function flowRun(status: string, flowSha: string, at: string): FlowResult {
  return { name: "01-promo", file: "flows/01-promo_test.md", status, attempts: 0, authored: false, steps: [{ index: 1, heading: "Step", status: "passed" }], asserts: { total: 1, passed: status === "passed" ? 1 : 0 }, lastRunAt: at, flowSha };
}

function run(at: string, flows = ["01-promo"], kaneVerdict?: KanePolicyVerdict): RunRecord {
  return { at, flows, outcome: "passed", durationS: 30, kaneVerdict };
}

/** Kane's history for one flow: each entry is [status, flow sha]. */
function history(...runs: Array<[string, string]>): KaneResults {
  return runs.reduce((results, [status, sha], i) => {
    const at = `2026-11-18T10:0${i}:00Z`;
    return mergeRun(results, run(at), [flowRun(status, sha, at)]);
  }, emptyResults());
}

describe("fix proof: the same test must fail, then pass", () => {
  const proofOf = (results: KaneResults) => fixProof(results, must(results.flows["01-promo"]));

  it("accepts a flow that failed and then passed with identical text", () => {
    expect(proofOf(history(["failed", "aaa"], ["passed", "aaa"]))).toEqual({ anchorAt: "2026-11-18T10:00:00Z", anchorFlow: "01-promo", failedFlow: "01-promo", failedAt: "2026-11-18T10:00:00Z", passedAt: "2026-11-18T10:01:00Z" });
  });

  it("refuses a flow that was edited between the failing and the passing run", () => {
    expect(proofOf(history(["failed", "aaa"], ["passed", "bbb"]))).toBeUndefined();
  });

  it("refuses a flow Kane never saw failing, or one that is still failing", () => {
    expect(proofOf(history(["passed", "aaa"]))).toBeUndefined();
    expect(proofOf(history(["failed", "aaa"], ["failed", "aaa"]))).toBeUndefined();
  });

  it("anchors to the first failing run: a test weakened after it failed can't prove a fix, however it gets to green", () => {
    expect(proofOf(history(["failed", "strict"], ["failed", "weak"], ["passed", "weak"]))).toBeUndefined();
    expect(proofOf(history(["failed", "strict"], ["failed", "weak"], ["failed", "strict"], ["passed", "strict"]))).toBeDefined();
  });

  it("moves the anchor only to a run where Kane itself confirmed a product bug", () => {
    const at = (i: number) => `2026-11-18T10:0${i}:00Z`;
    const bug = { confirmed: true, title: "Total row missing" };
    const runs: FlowResult[] = [
      flowRun("failed", "wrong-route", at(0)), // the test's own mistake
      { ...flowRun("failed", "right-route", at(1)), failure: { console: [], network: [], bugVerdict: bug } },
      flowRun("passed", "right-route", at(2)),
    ];
    const results = runs.reduce((acc, flow) => mergeRun(acc, run(flow.lastRunAt), [flow]), emptyResults());
    expect(proofOf(results)).toMatchObject({ failedAt: at(1), passedAt: at(2) });
  });
});

describe("pre-flight verdict rules", () => {
  const fixed = claim({ fix: { summary: "The experiment no longer trims the Total row", files: ["public/js/experiments.js"] } });

  it("only allows a fix or a withdrawn claim in pre-flight mode", () => {
    const judged = checkVerdict(verdict({ mode: "judge", claims: [fixed, claim({ id: "c2", status: "withdrawn", flow: undefined })] }));
    expect(judged.ok).toBe(false);
    if (!judged.ok) {
      expect(judged.errors.join("\n")).toMatch(/a judge never changes the project/);
      expect(judged.errors.join("\n")).toMatch(/only the builder can withdraw/);
    }
    expect(checkVerdict(verdict({ claims: [fixed] })).ok).toBe(true);
  });

  it("needs a reason to withdraw a claim and rejects an unknown mode", () => {
    const noReason = checkVerdict(verdict({ claims: [claim({ status: "withdrawn" })] }));
    expect(noReason.ok).toBe(false);
    expect(checkVerdict({ ...verdict(), mode: "god" }).ok).toBe(false);
  });

  it("rejects a recorded fix unless Kane saw the same test fail and then pass", () => {
    const v = verdict({ claims: [fixed] });
    expect(checkAgainstKane(v, history(["failed", "aaa"], ["passed", "aaa"]))).toEqual([]);
    expect(checkAgainstKane(v, history(["failed", "aaa"], ["passed", "bbb"])).join("\n")).toMatch(/same test failing and then passing/);
    expect(checkAgainstKane(v, history(["passed", "aaa"])).join("\n")).toMatch(/same test failing and then passing/);
  });

  it("asks for no Kane evidence behind a withdrawn claim", () => {
    const withdrawn = claim({ status: "withdrawn", fix: { summary: "Removed the order-history line from the README", files: ["README.md"] } });
    expect(checkAgainstKane(verdict({ claims: [withdrawn] }), emptyResults())).toEqual([]);
  });
});

describe("pre-flight scorecard", () => {
  const claims = [
    claim({ id: "c1", claim: "Browse" }),
    claim({ id: "c2", claim: "Promo", flow: "flows/02-promo_test.md", fix: { summary: "Kept the <b>Total</b> row", files: ["public/js/<x>.js"] } }),
    claim({ id: "c3", claim: "History", status: "withdrawn", flow: undefined, fix: { summary: "Removed from README", files: ["README.md"] } }),
    claim({ id: "c4", claim: "Export", status: "broken", flow: "flows/04-export_test.md" }),
  ];

  it("puts findings first and counts fixes and withdrawals in the headline", () => {
    const v = verdict({ claims });
    expect(claimsInReadingOrder(v).map((c) => c.id)).toEqual(["c4", "c2", "c1", "c3"]);
    expect(headline(v)).toBe("Kane proved 2 of 4 claims · 1 fixed in pre-flight · 1 broken · 1 withdrawn");
  });

  it("labels fixed and withdrawn claims and escapes what the fix says", () => {
    const html = renderScorecard({ verdict: verdict({ claims }), images: new Map() });
    expect(html).toContain('<span class="badge fixed">fixed</span>');
    expect(html).toContain('<span class="badge withdrawn">withdrawn</span>');
    expect(html).toContain("Kept the &lt;b&gt;Total&lt;/b&gt; row");
    expect(html).not.toContain("<x>.js");
    expect(html).toContain("Pre-flight");
    const md = renderReportMarkdown({ verdict: verdict({ claims }), images: new Map() });
    expect(md).toContain("Fixed in pre-flight: Kept the ‹b›Total‹/b› row");
    expect(md).toContain("the builder's own check before submitting");
  });

  it("marks pre-flight rows on the leaderboard", () => {
    const rows = boardRows([{ verdict: verdict() }, { verdict: verdict({ mode: "judge", project: { name: "Other", slug: "other" }, claims: [claim()] }) }]);
    expect(renderBoardMarkdown(rows)).toContain("[Inkwell](projects/inkwell/scorecard.html) (pre-flight)");
    expect(renderBoardMarkdown(rows)).not.toContain("[Other](projects/other/scorecard.html) (pre-flight)");
  });
});

describe("Kane's own verdict on the sealed evidence pack", () => {
  it("ships the same policy in policies/claims.yaml as the CLI writes at run time", () => {
    expect(readFileSync(join(ROOT, "policies", "claims.yaml"), "utf8")).toBe(CLAIMS_POLICY);
  });

  it("reads kane-cli's real --json output", () => {
    const kane = must(parsePolicyVerdict(`Skill update available\n${FAIL_OUTPUT}`));
    expect(kane.result).toBe("fail");
    expect(kane.failedGates).toEqual(["no-failed-flows"]);
    expect(kane.gates).toHaveLength(6);
    expect(kane.packSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(describePolicyVerdict(kane)).toBe("FAIL: no-failed-flows (totals.failed is 2, expected 0)");
    expect(describePolicyVerdict(PASS)).toBe("PASS (1 gate)");
  });

  it("returns nothing for output that holds no verdict", () => {
    expect(parsePolicyVerdict("")).toBeUndefined();
    expect(parsePolicyVerdict('{"verdicts":[{"policy":{"id":"unrelated-policy"},"result":"pass"}]}')).toBeUndefined();
    expect(parsePolicyVerdict('{"error":"usage"}\nnot json')).toBeUndefined();
  });

  it("prints Kane's verdict with the run summary", () => {
    const text = formatRunSummary({ ...run("2026-11-18T10:00:00Z", ["01-promo"], PASS), evidencePath: ".testmuai/evidence/x.evidence" }, [flowRun("passed", "aaa", "2026-11-18T10:00:00Z")], "projects/inkwell");
    expect(text).toContain("Kane's verdict on that sealed pack (kane-cli evidence verdict, policy kane-judge-claims): PASS (1 gate)");
  });

  it("signs the scorecard only when the latest run covered every claim's flow", () => {
    const two = verdict({ claims: [claim(), claim({ id: "c2", flow: "flows/02-promo_test.md" })] });
    const full: KaneResults = { version: 1, runs: [run("2026-11-18T10:00:00Z", ["01-promo", "02-promo"], PASS)], flows: {} };
    const partial: KaneResults = { version: 1, runs: [...full.runs, run("2026-11-18T10:05:00Z", ["02-promo"], PASS)], flows: {} };
    expect(kaneSignOff(two, full)?.kane.result).toBe("pass");
    expect(kaneSignOff(two, partial)).toBeUndefined();
    expect(renderScorecard({ verdict: two, results: full, images: new Map() })).toContain("Kane's verdict on the sealed evidence pack: <b>PASS</b>");
    expect(renderScorecard({ verdict: two, results: partial, images: new Map() })).not.toContain("Kane's verdict on the sealed evidence pack:");
  });

  it("leaves a withdrawn claim's flow out of what the final run must cover", () => {
    const v = verdict({ claims: [claim(), claim({ id: "c2", status: "withdrawn", flow: "flows/02-history_test.md", fix: { summary: "Removed", files: [] } })] });
    const results: KaneResults = { version: 1, runs: [run("2026-11-18T10:00:00Z", ["01-promo"], PASS)], flows: {} };
    expect(kaneSignOff(v, results)).toBeDefined();
  });
});

describe("a fixed claim shows the same test before and after", () => {
  const fixed = claim({ fix: { summary: "Stopped the experiment", files: ["data/experiments.json"] } });
  const failedRun = { ...flowRun("failed", "aaa", "2026-11-18T10:00:00Z"), screenshot: "evidence/01-promo-run1-failed.jpg" };
  const passedRun = { ...flowRun("passed", "aaa", "2026-11-18T10:07:00Z"), screenshot: "evidence/01-promo-run2-passed.jpg" };
  const results = mergeRun(mergeRun(emptyResults(), run("2026-11-18T10:00:00Z"), [failedRun]), run("2026-11-18T10:07:00Z"), [passedRun]);
  const images = new Map([
    ["evidence/01-promo-run1-failed.jpg", "data:image/jpeg;base64,BEFORE"],
    ["evidence/01-promo-run2-passed.jpg", "data:image/jpeg;base64,AFTER"],
  ]);

  it("keeps the failing run's screenshot next to the passing one", () => {
    expect(fixProof(results, must(results.flows["01-promo"]))).toMatchObject({ failedShot: "evidence/01-promo-run1-failed.jpg", passedShot: "evidence/01-promo-run2-passed.jpg" });
    expect(claimShots(fixed, results)).toEqual(["evidence/01-promo-run1-failed.jpg", "evidence/01-promo-run2-passed.jpg"]);
    expect(claimShots(claim(), results)).toEqual(["evidence/01-promo-run2-passed.jpg"]);
  });

  it("renders both, labelled with when Kane ran them", () => {
    const html = renderScorecard({ verdict: verdict({ claims: [fixed] }), results, images });
    expect(html).toContain("data:image/jpeg;base64,BEFORE");
    expect(html).toContain("data:image/jpeg;base64,AFTER");
    expect(html).toContain("Before · Kane&#39;s run at 10:00 UTC failed");
    expect(html).toContain("After · the same test at 10:07 UTC passed");
  });

  it("shows one screenshot for a claim that was never broken", () => {
    const html = renderScorecard({ verdict: verdict({ claims: [claim()] }), results, images });
    expect(html).not.toContain("BEFORE");
    expect(html).toContain("AFTER");
  });
});
