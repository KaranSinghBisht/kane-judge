import { describe, expect, it } from "vitest";
import { boardRows, renderBoardHtml, renderBoardMarkdown } from "../src/judge/board.js";
import { escapeHtml, safeHref } from "../src/judge/html.js";
import { renderReportMarkdown } from "../src/judge/report-md.js";
import { emptyResults, mergeRun, type FlowResult, type RunRecord } from "../src/judge/results.js";
import { headline, overall, renderScorecard } from "../src/judge/scorecard.js";
import { formatRunSummary } from "../src/judge/summary.js";
import type { Verdict } from "../src/judge/verdict.js";
import { checkVerdict } from "../src/judge/verdict-check.js";
import { slugify } from "../src/judge/workspace.js";

const XSS = `<script>alert(1)</script>" onerror="x`;

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    version: 1,
    project: { name: "Inkwell", slug: "inkwell", live: "https://inkwell.test", repo: "javascript:alert(1)" },
    summary: "Works mostly.",
    claims: [
      { id: "c1", claim: "Browse", source: "README", status: "proven", evidence: "Kane passed", flow: "flows/01-browse_test.md" },
      { id: "c2", claim: "Promo", source: "README", status: "broken", evidence: "Total hidden" },
      { id: "c3", claim: "History", source: "README", status: "unverifiable", evidence: "No account" },
    ],
    scores: [
      { criterion: "Works", score: 6, max: 10, why: "2 of 3" },
      { criterion: "Craft", score: 9, max: 10, why: "clean" },
    ],
    questions: ["Why is the Total hidden?"],
    flags: [],
    ...overrides,
  };
}

function flow(name: string, status = "passed"): FlowResult {
  return { name, file: `flows/${name}_test.md`, status, attempts: 0, authored: true, steps: [], lastRunAt: "2026-11-18T00:00:00Z" };
}

const RUN: RunRecord = { at: "2026-11-18T00:00:00Z", flows: ["01-browse"], outcome: "failed", durationS: 61 };

describe("scorecard", () => {
  it("computes the overall score and the headline", () => {
    expect(overall(verdict())).toEqual({ score: 15, max: 20, pct: 75 });
    expect(headline(verdict())).toBe("Kane proved 1 of 3 claims · 1 broken · 1 unverifiable");
  });

  it("escapes every untrusted string and refuses non-http links", () => {
    const v = verdict({ summary: XSS, flags: [XSS], claims: [{ id: "c", claim: XSS, source: XSS, status: "broken", evidence: XSS }] });
    const html = renderScorecard({ verdict: v, images: new Map() });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('" onerror="');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows the screenshot and Test Manager link of the claim's flow", () => {
    const results = mergeRun(emptyResults(), RUN, [{ ...flow("01-browse"), screenshot: "evidence/01-browse-pass.png", shareUrl: "https://tm.test/run/1" }]);
    const html = renderScorecard({ verdict: verdict(), results, images: new Map([["evidence/01-browse-pass.png", "data:image/png;base64,AAAA"]]) });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('href="https://tm.test/run/1"');
  });

  it("renders a markdown report without raw HTML from the submission", () => {
    const md = renderReportMarkdown({ verdict: verdict({ summary: XSS }), images: new Map() });
    expect(md).toContain("# Inkwell · 75% (15/20)");
    expect(md).not.toContain("<script>");
  });
});

describe("html helpers", () => {
  it("escapes quotes and backticks", () => {
    expect(escapeHtml(`a"b'c\`<`)).toBe("a&quot;b&#39;c&#96;&lt;");
  });

  it("only allows http(s) hrefs", () => {
    expect(safeHref("https://x.dev")).toBe("https://x.dev/");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,hi")).toBeUndefined();
  });
});

describe("verdict validation", () => {
  it("accepts a valid verdict", () => {
    expect(checkVerdict(verdict()).ok).toBe(true);
  });

  it("collects every problem in one pass", () => {
    const bad = { project: { name: "" }, summary: "", claims: [{ claim: "x", status: "great" }], scores: [{ criterion: "W", score: 12, max: 10 }] };
    const result = checkVerdict(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/project.*name/);
      expect(result.errors.join("\n")).toMatch(/status/);
      expect(result.errors.join("\n")).toMatch(/score/);
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("results and summary", () => {
  it("counts attempts per flow across runs and keeps earlier flows", () => {
    const first = mergeRun(emptyResults(), RUN, [flow("01-browse", "failed"), flow("02-promo", "failed")]);
    const second = mergeRun(first, { ...RUN, flows: ["01-browse"] }, [flow("01-browse")]);
    expect(second.flows["01-browse"]?.attempts).toBe(2);
    expect(second.flows["01-browse"]?.status).toBe("passed");
    expect(second.flows["02-promo"]?.attempts).toBe(1);
    expect(second.runs).toHaveLength(2);
  });

  it("prints each failure with Kane's words, console evidence and the screenshot", () => {
    const failed: FlowResult = {
      ...flow("02-promo", "failed"),
      screenshot: "evidence/02-promo-step-1.png",
      failure: { stepIndex: 1, stepHeading: "Apply SAVE10", kaneSays: "No Total row", console: [{ level: "warning", text: "limit-rows hid 1 of 4 rows" }], network: [] },
    };
    const text = formatRunSummary(RUN, [flow("01-browse"), failed], "projects/inkwell");
    expect(text).toContain("1 passed, 1 failed");
    expect(text).toContain('✗ 02-promo: failed at step 1 "Apply SAVE10". Kane: "No Total row"');
    expect(text).toContain("[warning] limit-rows hid 1 of 4 rows");
    expect(text).toContain("evidence/02-promo-step-1.png");
    expect(text).toContain("APP_BROKEN, TEST_WRONG or BLOCKED");
  });
});

describe("board", () => {
  it("ranks by score, then by proven claims", () => {
    const a = verdict({ project: { name: "A", slug: "a" } });
    const b = verdict({ project: { name: "B", slug: "b" }, scores: [{ criterion: "Works", score: 9, max: 10, why: "" }] });
    const c = verdict({ project: { name: "C", slug: "c" }, claims: [...verdict().claims, { id: "c4", claim: "x", source: "y", status: "proven", evidence: "z" }] });
    const rows = boardRows([{ verdict: a }, { verdict: b }, { verdict: c }]);
    expect(rows.map((r) => `${r.rank}:${r.name}`)).toEqual(["1:B", "2:C", "3:A"]);
    expect(renderBoardMarkdown(rows)).toContain("| 1 | [B](projects/b/scorecard.html) | 90% |");
    expect(renderBoardHtml(rows)).toContain('href="projects/b/scorecard.html"');
  });
});

describe("slugify", () => {
  it("makes safe folder names", () => {
    expect(slugify("My Cool-Project!! (v2)")).toBe("my-cool-project-v2");
    expect(slugify("💥")).toBe("project");
  });
});
