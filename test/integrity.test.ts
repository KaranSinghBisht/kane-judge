import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { guardedTarget } from "../src/cli/commands/hook.js";
import { scanArgProblems } from "../src/cli/commands/scan.js";
import { readCheckCounts } from "../src/evidence/pack.js";
import { parseFlowHeader } from "../src/flows/discover.js";
import { checkSentences, checksSha, claimOf, flowProblems, flowSteps, sharedClaims } from "../src/flows/validate.js";
import { checkAgainstKane, checkCoverage, checkMode, checkScoreEvidence, checkWithdrawn } from "../src/judge/evidence-check.js";
import { verifyPacks } from "../src/judge/pack-verify.js";
import { pendingProjects, pendingWork, recordNudge } from "../src/judge/pending.js";
import { emptyResults, flowVersions, mergeRun, type FlowResult, type KaneResults, type RunRecord } from "../src/judge/results.js";
import { renderScorecard, runTrail } from "../src/judge/scorecard.js";
import type { Verdict, VerdictClaim } from "../src/judge/verdict.js";
import { checkVerdict } from "../src/judge/verdict-check.js";
import { buildTestrunArgs, DEFAULT_RUN_CONFIG } from "../src/kane/runner.js";
import { parseUseCasePlan, quoteFor } from "../src/kane/usecases.js";
import { scanSubmission } from "../src/scan/scan.js";
import type { ScanResult } from "../src/scan/types.js";
import { configureLogger } from "../src/shared/logger.js";
import { buildPack } from "./helpers/pack.js";
import { must, useTempDirs, writeTree } from "./helpers/tmp.js";

/**
 * One test per way a scorecard could be made to say more than Kane saw. Each
 * was a real hole an outside review found by handing `report` a doctored project.
 */

const makeDir = useTempDirs();

beforeAll(() => {
  configureLogger({ stderr: false });
});

const at = (minute: number) => `2026-11-18T10:${String(minute).padStart(2, "0")}:00Z`;

function claim(over: Partial<VerdictClaim> = {}): VerdictClaim {
  return { id: "c1", claim: "Promo codes work", source: 'README: "Apply SAVE10 at checkout and the summary updates"', status: "proven", evidence: "Kane passed", flow: "flows/01-promo_test.md", ...over };
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return { version: 1, project: { name: "Shop", slug: "shop" }, summary: "s", claims: [claim()], scores: [{ criterion: "Works", score: 8, max: 10, why: "w" }], questions: [], flags: [], ...over };
}

function flow(name: string, status: string, minute: number, over: Partial<FlowResult> = {}): FlowResult {
  return {
    name,
    file: `flows/${name}_test.md`,
    status,
    attempts: 0,
    authored: true,
    steps: [{ index: 1, heading: "Step", status }],
    asserts: { total: 1, passed: status === "passed" ? 1 : 0 },
    claim: "c1",
    flowSha: "aaa",
    lastRunAt: at(minute),
    ...over,
  };
}

const run = (minute: number, flows: string[], over: Partial<RunRecord> = {}): RunRecord => ({ at: at(minute), flows, outcome: "passed", durationS: 30, ...over });

/** Results after Kane ran the given flows, one run each, in order. */
function ran(...flows: FlowResult[]): KaneResults {
  return flows.reduce((results, f) => mergeRun(results, { at: f.lastRunAt, flows: [f.name], outcome: "passed", durationS: 30 }, [f]), emptyResults());
}

const scan = (mode?: "judge" | "preflight"): ScanResult => ({ version: 1, mode, scannedAt: at(0), slug: "shop", name: "Shop", inputs: ["."], demoCandidates: [], repos: [], videos: [], injectionHints: [], pages: [] });

describe("lie 1: the verdict declares itself a pre-flight", () => {
  const fixed = verdict({ mode: "preflight", claims: [claim({ status: "withdrawn", fix: { summary: "Removed it", files: ["README.md"] } })] });

  it("is refused when the scan recorded the project as judged", () => {
    expect(checkMode(fixed, scan("judge")).join()).toContain("doesn't match the scan");
    expect(checkMode(fixed, scan()).join()).toContain("doesn't match the scan");
    expect(checkMode(fixed, undefined).join()).toContain("doesn't match the scan");
  });

  it("is accepted only when the builder's own folder was scanned with --preflight", () => {
    expect(checkMode(fixed, scan("preflight"))).toEqual([]);
    expect(checkMode(verdict(), scan("judge"))).toEqual([]);
    expect(checkMode(verdict(), scan("preflight")).join()).toContain('needs "mode": "preflight"');
  });

  it("can't be scanned for pre-flight from a URL, or without the running app's address", () => {
    const base = { live: "http://localhost:4173", workspace: "." };
    expect(scanArgProblems({ ...base, inputs: ["https://github.com/someone/else"], preflight: true }).join()).toContain("--preflight is for your own project");
    expect(scanArgProblems({ inputs: ["."], workspace: ".", preflight: true }).join()).toContain("--preflight needs the URL of your running app");
    expect(scanArgProblems({ ...base, inputs: ["."], preflight: true })).toEqual([]);
  });
});

describe("lie 2: a claim borrows another claim's passing flow", () => {
  const results = ran(flow("01-promo", "passed", 1, { claim: "c1" }), flow("02-history", "failed", 2, { claim: "c2" }));

  it("is refused when the flow was run for a different claim", () => {
    const borrowed = verdict({ claims: [claim(), claim({ id: "c2", flow: "flows/01-promo_test.md" })] });
    const errors = checkAgainstKane(borrowed, results).join("\n");
    expect(errors).toContain("01-promo already backs claim c1");
    expect(errors).toContain("which Kane ran as the flow for claim c1");
  });

  it("is refused when a claim Kane tested is left out of the verdict", () => {
    expect(checkAgainstKane(verdict(), results).join("\n")).toContain("Kane ran 02-history for claim c2, but the verdict has no claim c2");
  });

  it("is accepted when every claim stands on its own flow", () => {
    const honest = verdict({ claims: [claim(), claim({ id: "c2", status: "broken", flow: "flows/02-history_test.md" })] });
    expect(checkAgainstKane(honest, results)).toEqual([]);
  });

  it("is refused when the verdict points at an older flow of the claim instead of its latest run", () => {
    const renamed = ran(flow("01-promo-easy", "passed", 1), flow("01-promo", "failed", 2));
    const stale = verdict({ claims: [claim({ flow: "flows/01-promo-easy_test.md" })] });
    expect(checkAgainstKane(stale, renamed).join("\n")).toContain("Kane's latest run for claim c1 was 01-promo");
  });
});

describe("lie 3: a pass that asserted nothing", () => {
  it("can't prove a claim when Kane's evidence holds no passed assert step", () => {
    const hollow = ran(flow("01-promo", "passed", 1, { asserts: { total: 0, passed: 0 } }));
    expect(checkAgainstKane(verdict(), hollow).join()).toContain("holds no passed assert step");
  });

  it("can't prove a claim when the evidence pack could not be read at all", () => {
    const unread = ran(flow("01-promo", "passed", 1, { asserts: undefined }));
    expect(checkAgainstKane(verdict(), unread).join()).toContain("could not be read when it ran");
  });

  it("counts assert steps from Kane's own result.yaml", async () => {
    const dir = await makeDir();
    const result = "status: passed\nsteps:\n  - { id: 0-1, kind: navigate, status: passed }\n  - { id: 0-2, kind: assert, status: passed }\n  - { id: 0-3, kind: assert, status: failed }\n";
    const path = join(dir, "run.evidence");
    await writeFile(path, buildPack({ "tests/01-promo-0a1b2c3d/result.yaml": result, "tests/01-promo-0a1b2c3d/test.md": "# t" }));
    expect(await readCheckCounts(path, { testId: "01-promo-0a1b2c3d" })).toEqual({ asserts: 2, passed: 1 });
    expect(await readCheckCounts(join(dir, "missing.evidence"), {})).toBeUndefined();
  });
});

describe("lie 4: a flow that only looks like it checks something", () => {
  const header = "---\nurl: https://shop.example.app/\ntags: [judge, c1]\n---\n\n# Promo\n\n";
  const problems = (text: string) => flowProblems({ name: "01-promo", file: "flows/01-promo_test.md", ...parseFlowHeader(text) }, text).join("; ");

  it("needs the check in a step, as a sentence that checks", () => {
    expect(problems(`${header}## Apply\nApply SAVE10. Verify the summary visibly shows a Total.\n`)).toBe("");
    expect(problems(`${header}## Apply\nApply SAVE10. Do not verify anything.\n`)).toContain('no check in step "Apply"');
    expect(problems(`${header.replace("# Promo", "# Verify the promo")}## Apply\nApply SAVE10.\n`)).toContain('no check in step "Apply"');
    expect(problems(`${header}## Apply\nApply SAVE10 and verify the Total is visibly $47.00.\n`)).toBe("");
  });

  it("needs a check in every step, not just one of them", () => {
    expect(problems(`${header}## Add\nAdd the pen.\n\n## Apply\nApply SAVE10. Verify the Total is visibly shown.\n`)).toContain('no check in step "Add"');
  });

  it("doesn't count steps hidden in the frontmatter, an HTML comment or a code fence", () => {
    const hidden = "---\nurl: https://shop.example.app/\ntags: [judge, c1]\n# ## Verify in a YAML comment\n---\n# Promo\n<!--\n## Hidden\nVerify x.\n-->\n```\n## Fenced\nVerify y.\n```\n";
    expect(flowSteps(hidden)).toEqual([]);
    expect(problems(hidden)).toContain("no `## ` steps");
  });

  it("reads a flow that starts with a byte-order mark", () => {
    const withBom = `﻿${header}## Apply\nApply SAVE10. Verify the Total is visibly shown.\n`;
    expect(parseFlowHeader(withBom).url).toBe("https://shop.example.app/");
    expect(problems(withBom)).toBe("");
  });

  it("needs exactly one claim tag", () => {
    expect(problems(`${header.replace("[judge, c1]", "[judge]")}## Apply\nVerify the Total is visibly shown.\n`)).toContain("must name the one claim this flow tests");
    expect(claimOf(["judge", "c1", "c2"])).toBeUndefined();
    expect(claimOf(["judge", "C3"])).toBe("c3");
  });

  it("finds two flows that carry the same claim", () => {
    const flows = [
      { name: "02-strict", file: "flows/02-strict_test.md", tags: ["judge", "c2"] },
      { name: "02-easy", file: "flows/02-easy_test.md", tags: ["judge", "c2"] },
      { name: "01-ok", file: "flows/01-ok_test.md", tags: ["judge", "c1"] },
    ];
    expect(sharedClaims(flows)).toEqual([{ claim: "c2", files: ["flows/02-strict_test.md", "flows/02-easy_test.md"] }]);
  });

  it("tells a rewritten route from a rewritten check", () => {
    const route = "## Apply\nOpen the cart, then checkout. Verify the Total is visibly $47.00.";
    const otherRoute = "## Apply\nGo straight to /checkout.   verify the total is visibly $47.00.";
    const weaker = "## Apply\nOpen the cart, then checkout. Verify the page visibly loads.";
    expect(checksSha(route)).toBe(checksSha(otherRoute));
    expect(checksSha(route)).not.toBe(checksSha(weaker));
    expect(checkSentences("- Enter SAVE10\n- Then confirm the Total visibly reads $47.00")).toEqual(["Then confirm the Total visibly reads $47.00"]);
  });
});

describe("lie 5: renaming a flow to reset its history", () => {
  const renamed = ran(
    flow("01-promo", "failed", 1, { flowSha: "v1", checksSha: "strict" }),
    flow("01-promo", "failed", 2, { flowSha: "v2", checksSha: "strict" }),
    flow("01-promo-b", "failed", 3, { flowSha: "v3", checksSha: "weak" }),
    flow("01-promo-b", "passed", 4, { flowSha: "v4", checksSha: "weak" }),
  );
  const pointed = verdict({ claims: [claim({ flow: "flows/01-promo-b_test.md" })] });

  it("counts rewrites across every flow that carried the claim", () => {
    expect(flowVersions(renamed, must(renamed.flows["01-promo-b"]))).toBe(4);
    expect(checkAgainstKane(pointed, renamed).join()).toContain("rewritten 3 times before it passed; the limit is 2");
  });

  it("shows the whole trail on the scorecard, and says when the checks changed", () => {
    expect(runTrail(must(renamed.flows["01-promo-b"]), renamed)).toBe("✗ 10:01 → ✗ 10:02 (flow rewritten, same checks) → ✗ 10:03 (flow rewritten, checks changed) → ✓ 10:04 (flow rewritten, same checks)");
  });

  it("can't present a weakened test as a fix", () => {
    const weakened = ran(flow("01-promo", "failed", 1, { flowSha: "strict" }), flow("01-promo", "failed", 2, { flowSha: "weak" }), flow("01-promo", "passed", 3, { flowSha: "weak" }));
    const fixed = verdict({ mode: "preflight", claims: [claim({ fix: { summary: "Fixed", files: ["a.js"] } })] });
    expect(checkAgainstKane(fixed, weakened).join()).toContain("doesn't show the same test failing and then passing");
  });
});

describe("lie 6: proving a claim on another build than the one submitted", () => {
  const elsewhere = ran(flow("01-promo", "passed", 1, { startUrl: "http://localhost:4173" }));

  it("is refused when judging", () => {
    expect(checkAgainstKane(verdict(), elsewhere).join()).toContain("last passed against http://localhost:4173, not the submission's own demo");
  });

  it("is allowed in a pre-flight, and the scorecard says which build was used", () => {
    const pre = verdict({ mode: "preflight" });
    expect(checkAgainstKane(pre, elsewhere)).toEqual([]);
    expect(renderScorecard({ verdict: pre, results: elsewhere, images: new Map() })).toContain("run against <code>http://localhost:4173</code> instead of the flow's own URL");
  });
});

describe("lie 7: withdrawing a claim the README still makes", () => {
  const withdrawn = verdict({ mode: "preflight", claims: [claim({ status: "withdrawn", fix: { summary: "Removed", files: ["README.md"] } })] });

  const original = "# Shop\nApply SAVE10 at checkout and the summary updates";

  it("refuses a withdrawal with an invented original quotation", () => {
    expect(checkWithdrawn(withdrawn, "# Shop", "# Shop without the promise").join()).toContain("original scanned README");
  });

  it("is refused while the quoted promise is still in the README", () => {
    expect(checkWithdrawn(withdrawn, "# Shop\n\n- Apply **SAVE10** at checkout and the\n  summary updates with your discount.\n", original).join()).toContain("the README still says");
  });

  it("is accepted once the words are gone, and refused when the README cannot be checked", () => {
    expect(checkWithdrawn(withdrawn, "# Shop\n\n- Browse the catalogue.\n", original)).toEqual([]);
    expect(checkWithdrawn(withdrawn, undefined, original).join()).toContain("current README is missing");
  });
});

describe("lie 8: a score with nothing under it", () => {
  it("needs at least one claim", () => {
    const empty = checkVerdict(verdict({ claims: [], scores: [{ criterion: "Works", score: 10, max: 10, why: "great" }] }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.join()).toContain("needs at least one claim");
  });

  it("refuses a made-up score citation alongside a real one", () => {
    const mixed = verdict({ scores: [{ criterion: "Works", score: 8, max: 10, why: "c1 and c99", unverified: "on mobile" }] });
    expect(checkScoreEvidence(mixed).join()).toContain("unknown claims c99");
  });

  it("caps every criterion at 10, so one of them can't outweigh the rest", () => {
    const inflated = checkVerdict(verdict({ scores: [{ criterion: "Works", score: 1000, max: 1000, why: "great" }] }));
    expect(inflated.ok).toBe(false);
    if (!inflated.ok) expect(inflated.errors.join()).toContain('"max" can be at most 10');
  });

  it("leads the scorecard with Kane's count, and labels the rubric score as the agent's judgement", () => {
    const html = renderScorecard({ verdict: verdict({ claims: [claim(), claim({ id: "c2", status: "unverifiable", flow: undefined })] }), images: new Map() });
    expect(html).toContain('<b>1<span class="of">/2</span></b><span class="muted">claims proven by Kane</span>');
    expect(html).toContain("the agent's judgement");
  });
});

describe("lie 9: a results file that says more than Kane's sealed pack", () => {
  const packOf = (status: string) => buildPack({ "tests/01-promo-0a1b2c3d/result.yaml": `status: ${status}\nsteps:\n  - {kind: assert, status: ${status}}\n`, "run.yaml": "status: finalized\n" });
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  async function project(recorded: string, sealed: string, packSha?: string) {
    const dir = await makeDir();
    const bytes = packOf(sealed);
    await mkdir(join(dir, ".testmuai", "evidence"), { recursive: true });
    await writeFile(join(dir, ".testmuai", "evidence", "x.evidence"), bytes);
    const record = run(1, ["01-promo"], { evidencePath: ".testmuai/evidence/x.evidence", packSha256: packSha ?? sha(bytes) });
    return { dir, results: mergeRun(emptyResults(), record, [flow("01-promo", recorded, 1)]) };
  }

  it("is refused when a flow's recorded status differs from the pack's", async () => {
    const { dir, results } = await project("passed", "failed");
    const check = await verifyPacks(dir, results);
    expect(check.problems.join()).toContain("kane-results.json says 01-promo passed in the run at 2026-11-18 10:01 UTC, but Kane's sealed evidence pack says failed");
  });

  it("checks the failed and passing test text in the packs when a product fix is claimed", async () => {
    const dir = await makeDir();
    let results = emptyResults();
    for (const [minute, status, source] of [[1, "failed", "Verify the total is $42.80."], [2, "passed", "Verify checkout opens."]] as const) {
      const pack = buildPack({
        "tests/01-promo-0a1b2c3d/test.md": source,
        "tests/01-promo-0a1b2c3d/result.yaml": `status: ${status}\nsteps: [{kind: assert, status: ${status}}]\n`,
      });
      const path = `run-${minute}.evidence`;
      await writeFile(join(dir, path), pack);
      const record = run(minute, ["01-promo"], { outcome: status, evidencePath: path, packSha256: sha(pack) });
      results = mergeRun(results, record, [flow("01-promo", status, minute)]);
    }
    const fixed = verdict({ mode: "preflight", claims: [claim({ fix: { summary: "Restored Total", files: ["app.js"] } })] });
    const checked = await verifyPacks(dir, results, fixed);
    expect(checked.problems.join()).toContain("same test.md");
  });

  it("is refused when the pack is not the file Kane sealed", async () => {
    const { dir, results } = await project("passed", "passed", "0".repeat(64));
    expect((await verifyPacks(dir, results)).problems.join()).toContain("is not the file Kane sealed");
  });

  it("passes when results and pack agree, and refuses a pack that isn't there to read", async () => {
    const { dir, results } = await project("failed", "failed");
    expect(await verifyPacks(dir, results)).toEqual({ verified: 1, shared: 0, missing: 0, problems: [] });
    const absent = await verifyPacks(await makeDir(), results);
    expect(absent.missing).toBe(1);
    expect(absent.verified).toBe(0);
    expect(absent.problems.join()).toContain("is missing");
    const html = renderScorecard({ verdict: verdict({ claims: [claim({ status: "broken" })] }), results, images: new Map(), packs: { verified: 0, shared: 0, missing: 1, problems: [] } });
    expect(html).toContain("1 pack(s) were not on this machine");
  });

  it("never reads a pack outside the project", async () => {
    const { dir, results } = await project("passed", "failed");
    const outside = { ...results, runs: results.runs.map((r) => ({ ...r, evidencePath: "../../etc/x.evidence" })) };
    const checked = await verifyPacks(dir, outside);
    expect(checked.verified).toBe(0);
    expect(checked.problems.join()).toContain("no evidence pack inside the project");
  });
});

describe("lie 10: editing Kane's record instead of running Kane", () => {
  const tool = (tool_input: Record<string, unknown>) => guardedTarget({ tool_name: "x", tool_input });

  it("stops the file tools from touching the record", () => {
    expect(tool({ file_path: "/ws/projects/shop/kane-results.json" })).toBe("/ws/projects/shop/kane-results.json");
    expect(tool({ file_path: "projects/shop/scan.json" })).toBe("projects/shop/scan.json");
    expect(tool({ file_path: "projects/shop/.testmuai/evidence/x.evidence" })).toBeDefined();
    expect(tool({ file_path: "projects/shop/.kane-judge/running.json" })).toBeDefined();
  });

  it("lets the agent write what is its own: flows, the verdict, the product", () => {
    for (const file of ["projects/shop/verdict.json", "projects/shop/flows/01-promo_test.md", "src/checkout.js", "docs/scan.json.md", "README.md"]) expect(tool({ file_path: file })).toBeUndefined();
  });

  it("stops shell commands that rewrite the record, and allows reading it", () => {
    for (const command of [
      "sed -i '' s/failed/passed/ projects/shop/kane-results.json",
      "echo '{}' > projects/shop/scan.json",
      "python3 fix.py projects/shop/kane-results.json",
      "rm -rf projects/shop/.testmuai",
      "cp /tmp/good.json projects/shop/kane-results.json",
    ]) {
      expect(tool({ command })).toBeDefined();
    }
    for (const command of ["kane-judge run projects/shop --gate", "cat projects/shop/kane-results.json", "jq .runs projects/shop/kane-results.json", "node scripts/build.mjs", "kane-cli evidence serve projects/shop/.testmuai/evidence/x.evidence"]) {
      expect(tool({ command })).toBeUndefined();
    }
  });

  it("ignores input it doesn't understand", () => {
    expect(guardedTarget({})).toBeUndefined();
    expect(guardedTarget({ tool_input: "text" })).toBeUndefined();
  });
});

describe("the Stop hook reminds; it doesn't nag", () => {
  const NOW = Date.parse(at(30));
  const recent = (over: Partial<RunRecord> = {}): KaneResults => ({ version: 1, runs: [run(28, ["01-promo"], over)], flows: {} });

  it("speaks up once per Kane run", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(recent()) });
    const first = await pendingWork(ws, NOW);
    expect(first.map((p) => p.name)).toEqual(["projects/shop"]);
    await recordNudge(first);
    expect(await pendingProjects(ws, NOW)).toEqual([]);
    const next: KaneResults = { version: 1, runs: [...recent().runs, run(29, ["01-promo"])], flows: {} };
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(next) });
    expect(await pendingProjects(ws, NOW)).toEqual(["projects/shop"]);
  });

  it("stays quiet after a run Kane could not start", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(recent({ outcome: "error", reason: "not signed in" })) });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(recent({ outcome: "timeout" })) });
    expect(await pendingProjects(ws, NOW)).toEqual([]);
  });

  it("finds the workspace when the session sits inside a project folder", async () => {
    const ws = await makeDir();
    await writeTree(ws, { "projects/shop/kane-results.json": JSON.stringify(recent()), "projects/shop/flows/x.md": "x" });
    expect(await pendingProjects(join(ws, "projects", "shop", "flows"), NOW)).toEqual(["projects/shop"]);
  });
});

describe("two submissions with the same name", () => {
  it("never share a project folder", async () => {
    const ws = await makeDir();
    const one = join(await makeDir(), "app");
    const two = join(await makeDir(), "app");
    await writeTree(one, { "README.md": "# First app\n" });
    await writeTree(two, { "README.md": "# Second app\n" });
    const first = await scanSubmission({ inputs: [one], workspace: ws });
    expect(first.result.slug).toBe("app");
    expect(first.result.mode).toBe("judge");
    await expect(scanSubmission({ inputs: [two], workspace: ws })).rejects.toThrow(/projects\/app already holds another submission/);
    const again = await scanSubmission({ inputs: [one], workspace: ws, preflight: true });
    expect(again.result.mode).toBe("preflight");
    const own = await scanSubmission({ inputs: [two], workspace: ws, slug: "app-two" });
    expect(own.result.slug).toBe("app-two");
  });
});

describe("lie 11: testing only the promises that hold", () => {
  const README = ["# Shop", "", "## Features", "- Browse the catalogue.", "- Apply SAVE10 at checkout.", "- Find old orders under Account."].join("\n");
  // The `plan` event exactly as kane-cli 0.10.5 printed it for the sample README, with other events around it.
  const STREAM = [
    '{"type":"run_start","verb":"extract","mode":"override"}',
    "not json",
    '{"type":"plan","verb":"extract","source_id":"readme","use_cases":[{"risk":"high","title":"Apply a promo code at checkout","anchor":"L5-L5"},{"risk":"low","title":"Browse catalogue products","anchor":"L4-L4"},{"risk":"low","title":"Find previous orders","anchor":"L6-L6"}]}',
    '{"type":"done","verb":"extract","status":"complete","exit_code":0}',
  ].join("\n");
  const useCases = parseUseCasePlan(STREAM, README);
  const withUseCases: ScanResult = { ...scan("judge"), useCases };

  it("reads the use-cases Kane found in the README, with the lines they cite", () => {
    expect(useCases).toEqual([
      { id: "u1", title: "Apply a promo code at checkout", risk: "high", anchor: "L5-L5", quote: "- Apply SAVE10 at checkout." },
      { id: "u2", title: "Browse catalogue products", risk: "low", anchor: "L4-L4", quote: "- Browse the catalogue." },
      { id: "u3", title: "Find previous orders", risk: "low", anchor: "L6-L6", quote: "- Find old orders under Account." },
    ]);
    expect(quoteFor(README, "L4-L6")).toBe("- Browse the catalogue. - Apply SAVE10 at checkout. - Find old orders under Account.");
    expect(quoteFor(README, "somewhere")).toBeUndefined();
    expect(parseUseCasePlan("no plan here", README)).toEqual([]);
  });

  it("refuses a verdict that leaves out a use-case Kane found", () => {
    const partial = verdict({ claims: [claim({ covers: ["u1", "u2"] })] });
    expect(checkCoverage(partial, withUseCases).join()).toContain('Kane found use-case u3 "Find previous orders" in the README (L6-L6), and no claim covers it');
  });

  it("accepts it once every use-case has a claim, tested or not, and refuses ids the scan doesn't have", () => {
    const full = verdict({ claims: [claim({ covers: ["u1", "u2"] }), claim({ id: "c2", status: "untested", flow: undefined, evidence: "Out of budget.", covers: ["u3"] })] });
    expect(checkCoverage(full, withUseCases)).toEqual([]);
    expect(checkCoverage(verdict({ claims: [claim({ covers: ["u1", "u2", "u3", "u9"] })] }), withUseCases).join()).toContain("names u9, which is not a use-case in the scan");
    expect(checkCoverage(verdict(), scan("judge"))).toEqual([]);
  });

  it("shows the denominator on the scorecard", () => {
    const full = verdict({ claims: [claim({ covers: ["u1", "u2"] }), claim({ id: "c2", status: "untested", flow: undefined, covers: ["u3"] })] });
    const html = renderScorecard({ verdict: full, scan: withUseCases, images: new Map() });
    expect(html).toContain("Kane found 3 use-case(s) in the README: 2 tested by a Kane flow, 1 not");
    expect(html).toContain("Find previous orders");
  });

  it("accepts only well-formed use-case ids in a verdict", () => {
    const bad = checkVerdict({ ...verdict(), claims: [{ ...claim(), covers: ["first"] }] });
    expect(bad.ok).toBe(false);
    const ok = checkVerdict({ ...verdict(), claims: [{ ...claim(), covers: ["U2", "u2"] }] });
    expect(ok.ok && ok.verdict.claims[0]?.covers).toEqual(["u2"]);
  });
});

describe("lie 12: a score with no evidence under it", () => {
  it("is refused unless it cites a real claim or says what couldn't be verified", () => {
    const bare = verdict({ scores: [{ criterion: "Craft", score: 9, max: 10, why: "Looks polished." }] });
    expect(checkScoreEvidence(bare).join()).toContain('scores[0] (Craft): cite the claims this score rests on in "why"');
    expect(checkScoreEvidence(verdict({ scores: [{ criterion: "Craft", score: 9, max: 10, why: "c9 proven" }] })).length).toBe(1);
    expect(checkScoreEvidence(verdict({ scores: [{ criterion: "Works", score: 6, max: 10, why: "c1 proven in the live demo." }] }))).toEqual([]);
    expect(checkScoreEvidence(verdict({ scores: [{ criterion: "Originality", score: 5, max: 10, why: "A familiar idea.", unverified: "Nothing in the demo shows how it differs from other shops." }] }))).toEqual([]);
  });

  it("labels scores as suggestions and shows what couldn't be verified", () => {
    const html = renderScorecard({ verdict: verdict({ scores: [{ criterion: "Originality", score: 5, max: 10, why: "c1", unverified: "No way to compare." }] }), images: new Map() });
    expect(html).toContain("Suggested scores");
    expect(html).toContain("<b>Couldn't verify:</b> No way to compare.");
  });
});

describe("Kane's false passes, turned into rules", () => {
  const header = "---\nurl: https://shop.example.app/\ntags: [judge, c1]\n---\n\n# Promo\n\n";
  const problems = (text: string) => flowProblems({ name: "01-promo", file: "flows/01-promo_test.md", ...parseFlowHeader(text) }, text).join("; ");

  it("refuses a check that doesn't say what is visibly shown", () => {
    expect(problems(`${header}## Apply\nApply SAVE10. Verify the Order summary shows a Total row with the amount $47.00.\n`)).toContain("doesn't say what is visibly shown");
    expect(problems(`${header}## Apply\nApply SAVE10. Verify the Order summary visibly shows a Total row with the amount $47.00.\n`)).toBe("");
    expect(problems(`${header}## Apply\nApply SAVE10. Verify the URL ends in /checkout. Verify a Total is visible on the page.\n`)).toBe("");
  });

  it("replays the gate with Kane's self-healing off, so a pass is the recorded test", () => {
    const flows = [{ name: "01-promo", file: "flows/01-promo_test.md", tags: ["c1"] }];
    expect(buildTestrunArgs(flows, { ...DEFAULT_RUN_CONFIG, adaptiveHeal: false }, "gate")).toContain("--no-adaptive-heal");
    expect(buildTestrunArgs(flows, DEFAULT_RUN_CONFIG, "run")).not.toContain("--no-adaptive-heal");
  });
});
