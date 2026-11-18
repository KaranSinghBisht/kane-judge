import { flowStepHeadings, type Flow } from "./discover.js";

/** Words that make a step a check. Kane turns such a sentence into an assert step. */
const CHECK_WORDS = /\b(?:verify|confirm|assert|ensure|check that|expect)\b/i;

export const FLOW_EXAMPLE = `---
url: https://the-live-demo.example.app/
---

# Create a poll and vote on it

## Create a poll
Start a new poll titled "Kane Judge test poll" and publish it. Verify the poll page visibly shows that title.

## Vote
Vote for "Yes". Verify the results visibly show 1 vote for "Yes".`;

/**
 * Why Kane could not really run this flow. Kane CLI accepts a `_test.md` with
 * no `## ` steps, runs nothing and reports it as passed, so a malformed flow
 * must be stopped here, before it can "prove" a claim.
 */
export function flowProblems(flow: Flow, text: string): string[] {
  const problems: string[] = [];
  if (!flow.url) problems.push("no `url:` in the frontmatter (the page where a user starts)");
  else if (!/^https?:\/\/\S+$/i.test(flow.url)) problems.push(`\`url:\` must be an http(s) URL (got ${flow.url})`);
  const steps = flowStepHeadings(text);
  if (steps.length === 0) problems.push("no `## ` steps (Kane runs one step per `## ` heading; a numbered list is not a step)");
  else if (!CHECK_WORDS.test(text)) problems.push("no step has a check (end each step with \"Verify …\")");
  return problems;
}

/** The message `kane-judge run` prints instead of running flows Kane would pass without doing anything. */
export function describeFlowProblems(invalid: Array<{ file: string; problems: string[] }>): string {
  return [
    `Not run: ${invalid.length} flow(s) aren't valid Kane flows, and Kane would report them as passed without doing anything.`,
    ...invalid.map((f) => `  - ${f.file}: ${f.problems.join("; ")}`),
    "",
    "A flow looks like this:",
    "",
    FLOW_EXAMPLE,
  ].join("\n");
}
