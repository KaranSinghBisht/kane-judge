/**
 * Kane CLI agent-mode output: one JSON object per line on stdout.
 * Lines that are not JSON objects (banners, partial writes) are skipped and counted.
 */
export type KaneEvent = Record<string, unknown>;

export interface ParsedStream {
  events: KaneEvent[];
  skipped: number;
}

export function parseNdjsonLine(line: string): KaneEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as KaneEvent) : undefined;
  } catch {
    return undefined;
  }
}

export function parseNdjson(text: string): ParsedStream {
  const events: KaneEvent[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const event = parseNdjsonLine(line);
    if (event) events.push(event);
    else skipped++;
  }
  return { events, skipped };
}

export function eventType(e: KaneEvent): string | undefined {
  return typeof e.type === "string" ? e.type : undefined;
}

export function str(e: KaneEvent, key: string): string | undefined {
  const v = e[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function num(e: KaneEvent, key: string): number | undefined {
  const v = e[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function obj(e: KaneEvent, key: string): KaneEvent | undefined {
  const v = e[key];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as KaneEvent) : undefined;
}

export function arr(e: KaneEvent, key: string): unknown[] {
  const v = e[key];
  return Array.isArray(v) ? v : [];
}

export interface KaneErrorEvent {
  code?: string;
  message?: string;
  remedy?: string;
}

/** `{"type":"error",...}` events (refusals, auth problems, Test Manager issues). */
export function readErrorEvent(e: KaneEvent): KaneErrorEvent | undefined {
  if (eventType(e) !== "error") return undefined;
  return { code: str(e, "code"), message: str(e, "message"), remedy: str(e, "remedy") };
}
