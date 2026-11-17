import { parseNdjson, type KaneEvent } from "../kane/ndjson.js";
import { redact } from "../shared/errors.js";

export interface ConsoleEntry {
  level: string;
  text: string;
  /** Step attribution as recorded by Kane, when present. */
  step?: string;
}

export interface NetworkFailure {
  method: string;
  url: string;
  status: number;
  statusText?: string;
  step?: string;
}

const STEP_KEYS = ["step", "step_id", "stepId", "step_index", "stepIndex", "ordinal", "step_ordinal"];

function stepOf(record: Record<string, unknown>): string | undefined {
  for (const key of STEP_KEYS) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function firstString(record: KaneEvent, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function consoleText(record: KaneEvent): string | undefined {
  const direct = firstString(record, ["text", "message", "msg"]);
  if (direct) return direct;
  const args = record.args;
  if (Array.isArray(args)) {
    const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
    return parts.join(" ") || undefined;
  }
  return undefined;
}

/** Parses a `<n>-console.ndjson` log from an evidence pack. Unknown shapes are skipped. */
export function parseConsoleLog(text: string): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const record of parseNdjson(text).events) {
    const body = consoleText(record);
    if (!body) continue;
    if (/\/favicon\.ico(\?|$)/i.test(firstString(record, ["url"]) ?? "")) continue;
    const level = (firstString(record, ["level", "type", "severity"]) ?? "log").toLowerCase();
    entries.push({ level: level === "warn" ? "warning" : level, text: redact(body.slice(0, 500)), step: stepOf(record) });
  }
  return entries;
}

export function isProblem(entry: ConsoleEntry): boolean {
  return entry.level === "error" || entry.level === "warning" || entry.level === "assert";
}

interface HarEntry {
  request?: { method?: string; url?: string };
  response?: { status?: number; statusText?: string; _error?: string };
  _error?: string;
  [key: string]: unknown;
}

function harEntries(text: string): HarEntry[] {
  try {
    const har = JSON.parse(text) as { log?: { entries?: unknown } };
    const entries = har?.log?.entries;
    return Array.isArray(entries) ? (entries as HarEntry[]) : [];
  } catch {
    return [];
  }
}

function harStep(entry: HarEntry): string | undefined {
  const direct = stepOf(entry);
  if (direct) return direct;
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (key.startsWith("_") && typeof value === "object" && value !== null) {
      const nested = stepOf(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Failed requests (HTTP >= 400 or transport errors) from a `<n>-network.har` log. */
export function parseNetworkFailures(text: string): NetworkFailure[] {
  const failures: NetworkFailure[] = [];
  for (const entry of harEntries(text)) {
    const status = typeof entry.response?.status === "number" ? entry.response.status : 0;
    const transportError = entry._error ?? entry.response?._error;
    if (status < 400 && status > 0 && !transportError) continue;
    const url = entry.request?.url;
    if (!url || /\/favicon\.ico(\?|$)/i.test(url)) continue;
    failures.push({
      method: entry.request?.method ?? "GET",
      url: redact(url.length > 200 ? `${url.slice(0, 200)}…` : url),
      status,
      statusText: transportError ?? entry.response?.statusText,
      step: harStep(entry),
    });
  }
  return failures;
}

/**
 * Keeps entries attributed to the failing step (any of `stepKeys`) when Kane
 * recorded attribution; otherwise keeps the most recent entries.
 */
export function forStep<T extends { step?: string }>(items: T[], stepKeys: string[], limit: number): T[] {
  const keys = new Set(stepKeys);
  const attributed = keys.size > 0 ? items.filter((i) => i.step !== undefined && keys.has(i.step)) : [];
  const chosen = attributed.length > 0 ? attributed : items;
  return chosen.slice(-limit);
}
