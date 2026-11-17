import { readFileSync } from "node:fs";

export type Ev = Record<string, unknown>;

const TS = "2026-11-17T10:00:00.000Z";

/** A Kane agent-mode event: every line carries `v` and `ts` next to its `type`. */
export function ev(type: string, fields: Ev = {}): Ev {
  return { v: 1, ts: TS, type, ...fields };
}

/** Untyped progress event of `kane-cli run --agent` (identified by a numeric `step`). */
export function progressEv(step: number, status: string, remark?: string): Ev {
  return { v: 1, ts: TS, step, status, ...(remark === undefined ? {} : { remark }) };
}

export function toNdjson(events: Ev[]): string {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/** Reads a recorded stream from `test/fixtures/`. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

export const memberStart = (path: string, fields: Ev = {}): Ev =>
  ev("testrun_member_start", { path, test_id: "t-1", ...fields });

export const memberEnd = (path: string, status: string, fields: Ev = {}): Ev =>
  ev("testrun_member_end", { path, test_id: "t-1", status, duration_s: 10, ...fields });

export const testrunDone = (status: string, fields: Ev = {}): Ev =>
  ev("testrun_done", { execution_id: "exec-1", overall_status: status, ...fields });
