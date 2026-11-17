import type { FailureView, RunView } from "./view.js";

/** Claude Code caps hook strings at 10,000 characters; stay well under it. */
export const REPORT_LIMIT = 8_000;

function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function stepLabel(f: FailureView): string {
  if (f.stepIndex === undefined && !f.stepHeading) return "Failed";
  const idx = f.stepIndex !== undefined ? ` ${f.stepIndex}` : "";
  return `Failed at step${idx}${f.stepHeading ? ` "${clip(f.stepHeading, 80)}"` : ""}`;
}

function consoleLines(f: FailureView): string[] {
  if (f.console.length === 0) return ["  Browser console during the failing step: no errors or warnings"];
  return [
    "  Browser console during the failing step:",
    ...f.console.map((c) => `    [${c.level}] ${clip(c.text, 220)}`),
  ];
}

function networkLines(f: FailureView): string[] {
  if (f.network.length === 0) return ["  Failed network requests during the failing step: none"];
  return [
    "  Failed network requests during the failing step:",
    ...f.network.map((n) => `    ${n.method} ${clip(n.url, 160)} -> ${n.status || "no response"}${n.statusText ? ` ${clip(n.statusText, 60)}` : ""}`),
  ];
}

/** Everything known about one failing flow, as indented plain text. */
export function formatFailure(f: FailureView): string {
  const lines = [`✗ ${f.flowName} (${f.flowFile})${f.status !== "failed" ? ` [${f.status}]` : ""}`];
  lines.push(`  ${stepLabel(f)}${f.kaneSays ? `: ${clip(f.kaneSays, 600)}` : ""}`);
  if (f.error && f.error !== f.kaneSays) lines.push(`  Kane's error: ${clip(f.error, 400)}`);
  if (f.pageUrl) lines.push(`  Page: ${clip(f.pageUrl, 200)}`);
  lines.push(...consoleLines(f), ...networkLines(f));
  if (f.triage?.rootCause) lines.push(`  Kane's triage (a lead to check, not a verdict): ${clip(f.triage.rootCause, 500)}`);
  if (f.screenshotPath) lines.push(`  Screenshot of the failing step: ${f.screenshotPath} (open it with the Read tool)`);
  return lines.join("\n");
}

function passedLine(view: RunView): string | undefined {
  if (view.passed.length === 0) return undefined;
  const items = view.passed.map((p) => {
    const how = p.authored ? "authored" : "replayed";
    return `✓ ${p.flowName} (${how}${p.durationS !== undefined ? `, ${Math.round(p.durationS)}s` : ""})`;
  });
  return items.join(" · ");
}

function evidenceLine(view: RunView): string | undefined {
  if (!view.evidencePath) return undefined;
  return `Evidence pack: ${view.evidencePath} (view it with: kane-cli evidence serve ${view.evidencePath})`;
}

/** The `reason` of a Stop-hook block: what failed, why, and what to do next. */
export function formatBlockReason(view: RunView, attempt: number, maxAttempts: number, flowsDir: string): string {
  const failed = view.failures.length || 1;
  const head =
    `Kane Gate: not done yet. ${failed} of ${plural(view.totalFlows, "Kane flow")} failed in a real Chrome browser ` +
    `after your changes (attempt ${attempt} of ${maxAttempts}).`;
  const sections = [head, ...view.failures.map(formatFailure)];
  if (view.failures.length === 0 && view.detail) sections.push(`Kane reported:\n${view.detail}`);
  const tail = [passedLine(view), evidenceLine(view)].filter((s): s is string => !!s);
  const next =
    "Next: fix the application code so the failing flow passes, then end your turn; Kane Gate re-runs the affected " +
    `flows automatically. The flows in ${flowsDir} are the acceptance tests and are locked: change the app, not the ` +
    "tests. If a flow itself looks wrong, explain why and leave it for a human.";
  return fit([...sections, ...tail, next].join("\n\n"));
}

/** Keeps a report under the hook character cap, cutting the middle rather than the instructions. */
export function fit(text: string, limit = REPORT_LIMIT): string {
  if (text.length <= limit) return text;
  const keepTail = 700;
  return `${text.slice(0, limit - keepTail - 40)}\n…(report shortened)…\n${text.slice(text.length - keepTail)}`;
}

/** systemMessage shown to the user when every affected flow passed. */
export function formatReceipt(view: RunView, testUrl?: string): string {
  const parts = view.passed.map((p) => `${p.flowName} ${p.authored ? "authored" : "replayed"}`);
  const head = `Kane Gate ✓ verified in a real browser: ${view.passed.length}/${view.totalFlows} flows passed in ${view.durationS}s`;
  const extras = [view.evidencePath ? `evidence: ${view.evidencePath}` : undefined, testUrl ? `Test Manager: ${testUrl}` : undefined];
  return [`${head}${parts.length ? ` (${parts.join(", ")})` : ""}.`, ...extras.filter(Boolean)].join(" · ");
}

/** systemMessage when the attempt cap is reached: Claude may stop, a human takes over. */
export function formatNeedsHuman(view: RunView | undefined, attempts: number, reportPath: string): string {
  const first = view?.failures[0];
  const what = first
    ? `Last failure: ${first.flowName}, ${stepLabel(first).replace(/^Failed at /, "")}${first.kaneSays ? `: ${clip(first.kaneSays, 200)}` : ""}.`
    : "";
  return [
    `Kane Gate: still failing after ${plural(attempts, "attempt")}; Claude was allowed to stop. Needs a human.`,
    what,
    `Full report: ${reportPath}.`,
    view?.evidencePath ? `Evidence: ${view.evidencePath}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** systemMessage when Kane could not run at all (sign-in, Chrome, timeout). Never traps the agent. */
export function formatInfraWarning(reason: string, detail?: string): string {
  const firstLines = detail ? ` Kane said: ${clip(detail, 400)}` : "";
  return `Kane Gate could not verify this change: ${reason}.${firstLines} The change is NOT verified; run \`kane-gate run\` after fixing the setup (check \`kane-cli whoami\`).`;
}

/** Block reason asking Claude to describe untested behaviour as a new flow. */
export function formatNudge(files: string[], flowsDir: string, appUrl: string): string {
  const shown = files.slice(0, 12).join(", ") + (files.length > 12 ? `, and ${files.length - 12} more` : "");
  return [
    `Kane Gate: these changed files are not covered by any Kane flow: ${shown}.`,
    `If they change behaviour a user can see, add a flow that describes it in plain English as a new file ${flowsDir}/<name>_test.md ` +
      "(new flow files are allowed; existing ones are locked). Kane Gate runs it when you end your turn. " +
      "If the change is not user-visible, end your turn again and Kane Gate lets it through.",
    "Flow format (each ## step is one plain-English action that ends with a check):",
    ["---", `url: ${appUrl}`, "---", "# <What the user does>", "", "## <Step name>", 'Open the page, do one thing, and verify what the user should see, e.g. "Click Save and verify the toast says Saved."'].join("\n"),
  ].join("\n\n");
}

/** Plain-text report for `kane-gate run` and `.kane-gate/last-report.md`. */
export function formatTerminal(view: RunView): string {
  const ok = view.failures.length === 0 && !view.detail;
  const head = ok
    ? `PASS  ${view.passed.length}/${view.totalFlows} Kane flows passed in ${view.durationS}s`
    : `FAIL  ${view.failures.length || "?"} of ${view.totalFlows} Kane flows failed (${view.durationS}s)`;
  const body = [...view.failures.map(formatFailure), view.detail ? `Kane reported:\n${view.detail}` : undefined];
  const tail = [passedLine(view), evidenceLine(view)];
  return [head, ...body, ...tail].filter((s): s is string => !!s).join("\n\n");
}
