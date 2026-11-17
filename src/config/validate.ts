import { isAbsolute, normalize } from "node:path";
import { DEFAULTS, MAX_ATTEMPTS_CEILING, type FlowMapping, type KaneGateConfig } from "./schema.js";

export type ValidationResult =
  | { ok: true; config: KaneGateConfig; warnings: string[] }
  | { ok: false; errors: string[] };

const KNOWN_KEYS = [
  "$schema",
  "url",
  "devCommand",
  "readyUrl",
  "readyTimeoutSec",
  "flowsDir",
  "flows",
  "ignore",
  "maxAttempts",
  "headless",
  "timeoutSec",
  "parallel",
  "lockFlows",
  "coverageNudge",
  "kaneBin",
  "bugDetection",
] as const;

const SHELL_OPERATORS = /(&&|\|\||[|;<>`]|\$\()/;
const FLOW_NAME = /^[A-Za-z0-9][A-Za-z0-9_\-/.]*$/;

type Raw = Record<string, unknown>;

class Collector {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  error(key: string, message: string): void {
    this.errors.push(`"${key}" ${message}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  return typeof value === "object" ? "an object" : String(value);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length] ?? 0;
}

function suggestKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  return KNOWN_KEYS.find((k) => k.toLowerCase() === lower || editDistance(k.toLowerCase(), lower) <= 2);
}

function checkUnknownKeys(raw: Raw, c: Collector): void {
  for (const key of Object.keys(raw)) {
    if ((KNOWN_KEYS as readonly string[]).includes(key)) continue;
    const hint = suggestKey(key);
    c.errors.push(`unknown key "${key}"${hint ? ` (did you mean "${hint}"?)` : ""}`);
  }
}

function readHttpUrl(raw: Raw, key: string, c: Collector, required: boolean): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    if (required) c.error(key, 'is required, e.g. "http://localhost:3000"');
    return undefined;
  }
  if (typeof value !== "string") {
    c.error(key, `must be a URL string (got ${describe(value)})`);
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      c.error(key, `must use http:// or https:// (got ${describe(value)})`);
      return undefined;
    }
    return value;
  } catch {
    c.error(key, `is not a valid URL (got ${describe(value)})`);
    return undefined;
  }
}

function readInt(raw: Raw, key: string, range: [number, number], fallback: number, c: Collector): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < range[0] || value > range[1]) {
    c.error(key, `must be an integer from ${range[0]} to ${range[1]} (got ${describe(value)})`);
    return fallback;
  }
  return value;
}

function readBool(raw: Raw, key: string, fallback: boolean, c: Collector): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    c.error(key, `must be true or false (got ${describe(value)})`);
    return fallback;
  }
  return value;
}

function readStringArray(raw: Raw, key: string, c: Collector): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.trim() === "")) {
    c.error(key, `must be an array of non-empty strings (got ${describe(value)})`);
    return [];
  }
  return value as string[];
}

function readDevCommand(raw: Raw, c: Collector): string[] | undefined {
  const value = raw.devCommand;
  if (value === undefined) return undefined;
  const hint = 'use an argv array such as ["npm", "run", "dev"]';
  if (typeof value === "string") {
    if (SHELL_OPERATORS.test(value) || /["']/.test(value)) {
      c.error("devCommand", `runs without a shell, so quotes, pipes and && are not supported: ${hint}`);
      return undefined;
    }
    const argv = value.trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) c.error("devCommand", `must not be empty: ${hint}`);
    return argv.length ? argv : undefined;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== "")) {
    return value as string[];
  }
  c.error("devCommand", `must be a command string or a non-empty argv array: ${hint}`);
  return undefined;
}

function readFlowsDir(raw: Raw, c: Collector): string {
  const value = raw.flowsDir;
  if (value === undefined) return DEFAULTS.flowsDir;
  if (typeof value !== "string" || value.trim() === "") {
    c.error("flowsDir", `must be a relative directory path (got ${describe(value)})`);
    return DEFAULTS.flowsDir;
  }
  const norm = normalize(value).replace(/\\/g, "/").replace(/\/+$/, "");
  if (isAbsolute(value) || norm === ".." || norm.startsWith("../")) {
    c.error("flowsDir", `must stay inside the project (got ${describe(value)})`);
    return DEFAULTS.flowsDir;
  }
  return norm;
}

function readFlows(raw: Raw, c: Collector): Record<string, FlowMapping> {
  const value = raw.flows;
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    c.error("flows", `must be an object mapping flow names to { "paths": [globs] } (got ${describe(value)})`);
    return {};
  }
  const result: Record<string, FlowMapping> = {};
  for (const [name, entry] of Object.entries(value as Raw)) {
    const key = `flows.${name}`;
    if (!FLOW_NAME.test(name)) {
      c.error(key, "is not a valid flow name (use the file name without _test.md)");
      continue;
    }
    const paths = (entry as Raw | null)?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string" || p === "")) {
      c.error(`${key}.paths`, `must be a non-empty array of glob strings (got ${describe(paths)})`);
      continue;
    }
    result[name] = { paths: paths as string[] };
  }
  return result;
}

function readBugDetection(raw: Raw, c: Collector): KaneGateConfig["bugDetection"] {
  const value = raw.bugDetection;
  if (value === undefined) return undefined;
  if (value === "off" || value === "stop" || value === "continue") return value;
  c.error("bugDetection", `must be "off", "stop" or "continue" (got ${describe(value)})`);
  return undefined;
}

function readKaneBin(raw: Raw, c: Collector): string {
  const value = raw.kaneBin;
  if (value === undefined) return DEFAULTS.kaneBin;
  if (typeof value !== "string" || value.trim() === "") {
    c.error("kaneBin", `must be a non-empty executable name or path (got ${describe(value)})`);
    return DEFAULTS.kaneBin;
  }
  return value;
}

/** Validates parsed kane-gate.json and fills in defaults. Collects every problem, not just the first. */
export function validateConfig(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`kane-gate.json must contain a JSON object (got ${describe(raw)})`] };
  }
  const r = raw as Raw;
  const c = new Collector();
  checkUnknownKeys(r, c);
  const config: KaneGateConfig = {
    url: readHttpUrl(r, "url", c, true) ?? "",
    devCommand: readDevCommand(r, c),
    readyUrl: readHttpUrl(r, "readyUrl", c, false),
    readyTimeoutSec: readInt(r, "readyTimeoutSec", [1, 600], DEFAULTS.readyTimeoutSec, c),
    flowsDir: readFlowsDir(r, c),
    flows: readFlows(r, c),
    ignore: readStringArray(r, "ignore", c),
    maxAttempts: readInt(r, "maxAttempts", [1, MAX_ATTEMPTS_CEILING], DEFAULTS.maxAttempts, c),
    headless: readBool(r, "headless", DEFAULTS.headless, c),
    timeoutSec: readInt(r, "timeoutSec", [30, 3600], DEFAULTS.timeoutSec, c),
    parallel: readInt(r, "parallel", [1, 16], DEFAULTS.parallel, c),
    lockFlows: readBool(r, "lockFlows", DEFAULTS.lockFlows, c),
    coverageNudge: readBool(r, "coverageNudge", DEFAULTS.coverageNudge, c),
    kaneBin: readKaneBin(r, c),
    bugDetection: readBugDetection(r, c),
  };
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, config, warnings: c.warnings };
}
