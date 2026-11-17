import type { FlowResult, KaneResults, RunRecord } from "./results.js";

/** Plain-text report of a Kane run, written for Claude to read and act on. */
function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function passedLine(flow: FlowResult): string {
  const how = flow.authored ? "authored by Kane" : "replayed";
  const extras = [
    flow.durationS !== undefined ? `${Math.round(flow.durationS)}s` : undefined,
    flow.screenshot ? `final screen: ${flow.screenshot}` : undefined,
    flow.shareUrl ? `Test Manager: ${flow.shareUrl}` : undefined,
  ].filter(Boolean);
  return `✓ ${flow.name}: passed (${how}${extras.length ? `, ${extras.join(", ")}` : ""})`;
}

function failureLines(flow: FlowResult): string[] {
  const f = flow.failure;
  const where =
    f?.stepIndex !== undefined || f?.stepHeading
      ? `failed at step ${f?.stepIndex ?? "?"}${f?.stepHeading ? ` "${clip(f.stepHeading, 80)}"` : ""}`
      : `${flow.status}`;
  const lines = [`✗ ${flow.name}: ${where}${f?.kaneSays ? `. Kane: "${clip(f.kaneSays, 500)}"` : ""}`];
  if (f?.error && f.error !== f.kaneSays) lines.push(`    Kane's failure record: ${clip(f.error, 300)}`);
  if (f?.pageUrl) lines.push(`    Page: ${clip(f.pageUrl, 200)}`);
  const consoleProblems = f?.console ?? [];
  lines.push(consoleProblems.length ? `    Console: ${consoleProblems.map((c) => `[${c.level}] ${clip(c.text, 160)}`).join(" | ")}` : "    Console: no errors or warnings");
  const network = f?.network ?? [];
  if (network.length) lines.push(`    Failed requests: ${network.map((n) => `${n.method} ${clip(n.url, 100)} -> ${n.status || "no response"}`).join(" | ")}`);
  if (f?.triage?.rootCause) lines.push(`    Kane's triage (a lead, not a verdict): ${clip(f.triage.rootCause, 300)}`);
  if (flow.screenshot) lines.push(`    Screenshot: ${flow.screenshot} (open it with the Read tool)`);
  if (flow.shareUrl) lines.push(`    Test Manager: ${flow.shareUrl}`);
  return lines;
}

/** The text `kane-judge run` prints: one block per flow that ran, then what to do next. */
export function formatRunSummary(run: RunRecord, flows: FlowResult[], projectLabel: string): string {
  const passed = flows.filter((f) => f.status === "passed");
  const failed = flows.filter((f) => f.status !== "passed" && f.status !== "skipped");
  const head = `Kane ran ${flows.length} flow(s) for ${projectLabel} in real Chrome (${run.durationS}s): ${passed.length} passed, ${failed.length} failed.`;
  const body = [...passed.map(passedLine), ...failed.flatMap(failureLines)];
  const tail = [
    run.evidencePath ? `Evidence pack: ${run.evidencePath} (open with: kane-cli evidence serve ${run.evidencePath})` : undefined,
    failed.length
      ? "Next: classify each ✗ as APP_BROKEN, TEST_WRONG or BLOCKED using the evidence above. Rewrite only TEST_WRONG flows (change how the flow reaches the feature, never what the claim promises), then re-run them with --only."
      : "Next: every flow passed. Record the proven claims in verdict.json.",
  ].filter((s): s is string => !!s);
  return [head, "", ...body, "", ...tail].join("\n");
}

/** The text printed when Kane could not run at all. */
export function formatRunProblem(run: RunRecord): string {
  const detail = run.detail ? `\nKane said: ${clip(run.detail, 600)}` : "";
  return `Kane could not run the flows: ${run.reason ?? run.outcome}.${detail}\nCheck \`kane-cli whoami\` (sign in with \`kane-cli login --oauth\`) and that Chrome is installed. This is a setup problem, not evidence about the project.`;
}

/** One line per flow across all runs so far, for status checks. */
export function formatResultsOverview(results: KaneResults): string {
  const flows = Object.values(results.flows);
  if (flows.length === 0) return "No Kane results yet.";
  return flows
    .map((f) => `${f.status === "passed" ? "✓" : "✗"} ${f.name}: ${f.status} after ${f.attempts} run(s)${f.screenshot ? ` · ${f.screenshot}` : ""}`)
    .join("\n");
}
