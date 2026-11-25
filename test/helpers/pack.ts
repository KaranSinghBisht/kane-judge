import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";

export type PackFiles = Record<string, string | Uint8Array>;

/** PNG magic bytes plus a few more: enough to prove the screenshot is copied byte for byte. */
export const SCREENSHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

export const FAILURE_YAML = `error:
  message: Expected the order summary to show a Total row
page_state:
  url: http://localhost:4173/checkout.html
  title: Checkout
triage:
  rca:
    root_cause: The promo handler never recomputes the total
  suggested_fix:
    summary: Recompute the total after applying the code
`;

/** Builds an evidence pack (a plain zip) in memory. */
export function buildPack(files: PackFiles): Uint8Array {
  const entries: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === "string" ? strToU8(content) : content;
  }
  // ZIP timestamps otherwise change fixture hashes when assertions cross a two-second boundary.
  return zipSync(entries, { mtime: new Date(2026, 0, 1) });
}

export async function writePack(dir: string, files: PackFiles, name = "exec-1.evidence"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, buildPack(files));
  return path;
}

export function consoleLog(records: Array<Record<string, unknown>>): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

export function har(entries: unknown[]): string {
  return JSON.stringify({ log: { version: "1.2", entries } });
}

/** A pack as Kane seals it for a failing run: one test whose step 2 (dir 0002-abc) failed. */
export function failingPack(over: PackFiles = {}): PackFiles {
  return {
    "tests/t-1/test.md": "# Check out\n\n## Pay\nClick Pay.\n",
    "tests/t-1/steps/0001-aaa/step.yaml": "ok: true\n",
    "tests/t-1/steps/0002-abc/failure.yaml": FAILURE_YAML,
    "tests/t-1/steps/0002-abc/annotated.png": SCREENSHOT,
    "tests/t-1/logs/0-console.ndjson": consoleLog([
      { level: "error", text: "TypeError: Cannot read properties of undefined (reading 'total')", step: "2" },
      { level: "warn", text: "deprecated API", step: "2" },
      { level: "log", text: "just chatting", step: "2" },
      { level: "error", text: "error from another step", step: "1" },
    ]),
    "tests/t-1/logs/0-network.har": har([
      { request: { method: "GET", url: "http://localhost:4173/" }, response: { status: 200 }, step: 2 },
      { request: { method: "POST", url: "http://localhost:4173/api/promo" }, response: { status: 500, statusText: "Internal Server Error" }, step: 2 },
      { request: { method: "GET", url: "http://localhost:4173/other" }, response: { status: 404, statusText: "Not Found" }, step: 1 },
    ]),
    ...over,
  };
}
