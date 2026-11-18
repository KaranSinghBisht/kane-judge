import { createHash } from "node:crypto";
import type { Flow } from "./discover.js";

const CHECK_WORD = "(?:verify|confirm|assert|ensure|check that)\\b";
/** A check is a sentence that opens with a check word ("Verify the total…"), or reaches one after "and", "then" or a comma. */
const CHECK_START = new RegExp(`^(?:(?:and|then|and then|finally|also)\\s+)?${CHECK_WORD}`, "i");
const CHECK_INNER = new RegExp(`(?:,\\s*|\\b(?:and|then)\\s+)${CHECK_WORD}`, "i");
/** A check about what a user sees. */
const VISIBLE = /\bvisibl[ey]\b/i;
/** The claim a flow tests: `c1`, `c2`… among its tags. */
const CLAIM_TAG = /^c\d+$/i;

export const FLOW_EXAMPLE = `---
url: https://the-live-demo.example.app/
tags: [judge, c1]
---

# Create a poll and vote on it

## Create a poll
Start a new poll titled "Kane Judge test poll" and publish it. Verify the poll page visibly shows that title.

## Vote
Vote for "Yes". Verify the results visibly show 1 vote for "Yes".`;

export interface FlowStep {
  heading: string;
  body: string;
}

/** Removes a leading byte-order mark, which would otherwise hide the frontmatter. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Blanks out a fenced code block or HTML comment between `open` and `close`, wherever it occurs. Linear. */
function blank(text: string, open: string, close: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(open, i);
    if (start === -1) break;
    parts.push(text.slice(i, start));
    const end = text.indexOf(close, start + open.length);
    i = end === -1 ? text.length : end + close.length;
  }
  parts.push(text.slice(i));
  return parts.join("\n");
}

/**
 * The steps Kane would run: `## ` headings in the body, with what follows each.
 * Frontmatter, HTML comments and fenced code are not part of the flow.
 */
export function flowSteps(raw: string): FlowStep[] {
  const text = stripBom(raw);
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  const body = blank(blank(frontmatter ? text.slice(frontmatter[0].length) : text, "<!--", "-->"), "```", "```");
  const steps: FlowStep[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(\S.*)$/.exec(line);
    if (heading) steps.push({ heading: (heading[1] ?? "").trim(), body: "" });
    else {
      const current = steps[steps.length - 1];
      if (current) current.body += `${line}\n`;
    }
  }
  return steps;
}

/**
 * The sentences of a step that state a check; Kane turns each into an assert step.
 * "Do not verify anything" is not one: the check word has to lead its clause.
 */
export function checkSentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter((sentence) => CHECK_START.test(sentence) || CHECK_INNER.test(sentence));
}

/**
 * A fingerprint of what a flow checks, apart from how it gets there. When a
 * flow is rewritten, the scorecard says whether its checks changed too.
 */
export function checksSha(text: string): string {
  const checks = flowSteps(text).flatMap((step) => checkSentences(step.body));
  return createHash("sha256").update(checks.map((c) => c.replace(/\s+/g, " ").toLowerCase()).join("\n")).digest("hex");
}

/** The claim id a flow carries in its tags (lower-cased), when it carries exactly one. */
export function claimOf(tags: string[]): string | undefined {
  const ids = tags.filter((tag) => CLAIM_TAG.test(tag));
  return ids.length === 1 ? ids[0]?.toLowerCase() : undefined;
}

/**
 * Why Kane could not really run this flow, or why its result could not back a
 * claim. Kane CLI accepts a `_test.md` with no `## ` steps, runs nothing and
 * reports it as passed, so a malformed flow has to be stopped here.
 */
export function flowProblems(flow: Flow, text: string): string[] {
  const problems: string[] = [];
  if (!flow.url) problems.push("no `url:` in the frontmatter (the page where a user starts)");
  else if (!/^https?:\/\/\S+$/i.test(flow.url)) problems.push(`\`url:\` must be an http(s) URL (got ${flow.url})`);
  if (!claimOf(flow.tags)) problems.push("the frontmatter `tags:` must name the one claim this flow tests, e.g. `tags: [judge, c1]`");
  const steps = flowSteps(text);
  if (steps.length === 0) problems.push("no `## ` steps (Kane runs one step per `## ` heading; a numbered list is not a step)");
  const unchecked = steps.filter((step) => checkSentences(step.body).length === 0).map((step) => `"${step.heading}"`);
  if (unchecked.length) problems.push(`no check in step ${unchecked.join(", ")} (end each step with a sentence that starts "Verify …")`);
  // Kane can pass a check on text that is in the page's HTML but hidden (3 of 7 runs in our trials, 0 of 6 once
  // the check said "visibly"), so every step has to check something a user can see.
  const unseen = steps.filter((step) => checkSentences(step.body).length > 0 && !checkSentences(step.body).some((c) => VISIBLE.test(c))).map((step) => `"${step.heading}"`);
  if (unseen.length) problems.push(`the check in step ${unseen.join(", ")} doesn't say what is visibly shown (write "Verify the summary visibly shows a Total of $47.00": Kane can pass a check on text that is in the page but hidden)`);
  return problems;
}

/**
 * Claims that more than one flow in the folder carries. One Kane flow tests one
 * claim: with two, a verdict could point at whichever result is friendlier.
 */
export function sharedClaims(flows: Flow[]): Array<{ claim: string; files: string[] }> {
  const byClaim = new Map<string, string[]>();
  for (const flow of flows) {
    const claim = claimOf(flow.tags);
    if (claim) byClaim.set(claim, [...(byClaim.get(claim) ?? []), flow.file]);
  }
  return [...byClaim].filter(([, files]) => files.length > 1).map(([claim, files]) => ({ claim, files }));
}

/** The message `kane-judge run` prints instead of running flows whose result could not be trusted. */
export function describeFlowProblems(invalid: Array<{ file: string; problems: string[] }>): string {
  return [
    `Not run: ${invalid.length} flow(s) aren't valid Kane flows for a claim. Kane would report a flow without steps as passed without doing anything.`,
    ...invalid.map((f) => `  - ${f.file}: ${f.problems.join("; ")}`),
    "",
    "A flow looks like this:",
    "",
    FLOW_EXAMPLE,
  ].join("\n");
}
