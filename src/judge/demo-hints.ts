import { findInjectionHints } from "../scan/injection.js";
import type { FlowResult } from "./results.js";

/**
 * Text a demo itself emits while Kane uses it (console lines, page text Kane
 * quotes) can try to instruct an AI judge just like a README can. Returns the
 * same kind of red-flag excerpts the scan produces for the submission text.
 */
export function demoInjectionHints(flows: FlowResult[]): string[] {
  const sources: Record<string, string> = {};
  for (const flow of flows) {
    const failure = flow.failure;
    if (!failure) continue;
    const consoleText = failure.console.map((c) => c.text).join("\n");
    if (consoleText) sources[`demo console during ${flow.name}`] = consoleText;
    if (failure.kaneSays) sources[`demo page text Kane quoted in ${flow.name}`] = failure.kaneSays;
  }
  return findInjectionHints(sources);
}
