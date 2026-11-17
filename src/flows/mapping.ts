import picomatch from "picomatch";
import type { KaneGateConfig } from "../config/schema.js";
import type { Flow } from "./discover.js";

export interface FlowSelection {
  /** Flows whose mapping matches at least one changed file (or whose own file changed). */
  affected: Flow[];
  /** Changed files that no flow covers. */
  uncovered: string[];
}

const DEFAULT_GLOBS = ["**"];

export function globsFor(flow: Flow, config: KaneGateConfig): string[] {
  return config.flows[flow.name]?.paths ?? DEFAULT_GLOBS;
}

function matcherFor(globs: string[]): (path: string) => boolean {
  return picomatch(globs, { dot: true });
}

/** Builds a predicate for "ignored" paths (built-in + configured globs). */
export function ignoreMatcher(globs: readonly string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false;
  return picomatch([...globs], { dot: true });
}

/**
 * Picks the flows affected by a set of changed files. `unknown` means change
 * detection could not tell what changed (e.g. history was rewritten), so every
 * flow runs.
 */
export function selectFlows(
  flows: Flow[],
  config: KaneGateConfig,
  changed: string[],
  unknown = false,
): FlowSelection {
  if (unknown) return { affected: [...flows], uncovered: [] };
  const flowFiles = new Set(flows.map((f) => f.file));
  const matchers = new Map(flows.map((f) => [f.name, matcherFor(globsFor(f, config))]));
  const affected = flows.filter((flow) => {
    if (changed.includes(flow.file)) return true;
    const match = matchers.get(flow.name);
    return match ? changed.some((file) => match(file)) : false;
  });
  const uncovered = changed.filter((file) => {
    if (flowFiles.has(file) || file.startsWith(`${config.flowsDir}/`)) return false;
    return ![...matchers.values()].some((match) => match(file));
  });
  return { affected, uncovered };
}

/** Config mappings that point at flows which do not exist (likely typos). */
export function unknownMappings(flows: Flow[], config: KaneGateConfig): string[] {
  const names = new Set(flows.map((f) => f.name));
  return Object.keys(config.flows).filter((name) => !names.has(name));
}
