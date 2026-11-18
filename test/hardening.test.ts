import { describe, expect, it } from "vitest";
import { boardRows, renderBoardMarkdown } from "../src/judge/board.js";
import { checkAgainstKane } from "../src/judge/evidence-check.js";
import { mdText } from "../src/judge/markdown.js";
import { emptyResults, mergeRun, type FlowResult } from "../src/judge/results.js";
import type { Verdict, VerdictClaim } from "../src/judge/verdict.js";
import type { ScanResult } from "../src/scan/types.js";
import { isPrivateHost } from "../src/scan/page.js";

function claim(over: Partial<VerdictClaim>): VerdictClaim {
  return { id: "c1", claim: "x", source: "README", status: "proven", evidence: "e", flow: "flows/01-a_test.md", ...over };
}

function verdictWith(claims: VerdictClaim[]): Verdict {
  return { version: 1, project: { name: "P", slug: "p" }, summary: "s", claims, scores: [{ criterion: "W", score: 5, max: 10, why: "w" }], questions: [], flags: [] };
}

function results(status: string) {
  const flow: FlowResult = { name: "01-a", file: "flows/01-a_test.md", status, attempts: 0, authored: true, steps: [{ index: 1, heading: "Step", status: "passed" }], lastRunAt: "t" };
  return mergeRun(emptyResults(), { at: "t", flows: ["01-a"], outcome: "passed", durationS: 1 }, [flow]);
}

describe("evidence or it didn't happen (enforced in code)", () => {
  it("accepts proven claims whose Kane flow passed", () => {
    expect(checkAgainstKane(verdictWith([claim({})]), results("passed"))).toEqual([]);
  });

  it("rejects a proven claim whose Kane flow failed, or that has no flow or no Kane result", () => {
    expect(checkAgainstKane(verdictWith([claim({})]), results("failed"))[0]).toContain("marked proven, but Kane's latest run of 01-a failed");
    expect(checkAgainstKane(verdictWith([claim({ flow: undefined })]), results("passed"))[0]).toContain("needs the Kane flow");
    expect(checkAgainstKane(verdictWith([claim({})]), undefined)[0]).toContain("Kane has no result");
  });

  it("requires Kane evidence for broken claims but not for unverifiable ones", () => {
    expect(checkAgainstKane(verdictWith([claim({ status: "broken" })]), results("failed"))).toEqual([]);
    expect(checkAgainstKane(verdictWith([claim({ status: "unverifiable", flow: undefined })]), undefined)).toEqual([]);
  });
});

describe("markdown escaping of untrusted text", () => {
  it("neutralises links, images, emphasis, tables and raw HTML", () => {
    const out = mdText("[x](https://evil) ![i](https://e/i.png) *b* | col <script>");
    expect(out).not.toMatch(/(^|[^\\])\[x\]\(/);
    expect(out).toContain("\\[x\\]\\(https://evil\\)");
    expect(out).toContain("\\|");
    expect(out).not.toContain("<script>");
  });

  it("keeps leaderboard links pointed at the project folder whatever the name says", () => {
    const v = { ...verdictWith([claim({})]), project: { name: "a](https://evil) [b", slug: "evil-slug" } };
    const scan = { injectionHints: ["README: hidden note"] } as ScanResult;
    const rows = boardRows([{ verdict: v, results: results("passed"), scan, dir: "real-folder" }]);
    expect(rows[0]?.flags).toBe(1);
    const md = renderBoardMarkdown(rows);
    expect(md).toContain("(projects/real-folder/scorecard.html)");
    expect(md).not.toContain("](https://evil)");
  });
});

describe("isPrivateHost", () => {
  it("flags loopback, private, link-local and metadata addresses", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://172.20.0.1", "http://169.254.169.254/latest", "http://[::1]/", "http://printer.local"]) {
      expect(isPrivateHost(url)).toBe(true);
    }
  });

  it("allows public hosts", () => {
    for (const url of ["https://inkwell-shop.vercel.app", "https://8.8.8.8", "https://172.32.0.1", "https://github.com"]) expect(isPrivateHost(url)).toBe(false);
  });
});
