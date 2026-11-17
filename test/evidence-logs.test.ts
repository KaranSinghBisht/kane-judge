import { describe, expect, it } from "vitest";
import { forStep, isProblem, parseConsoleLog, parseNetworkFailures } from "../src/evidence/logs.js";
import { har } from "./helpers/pack.js";

const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;

describe("parseConsoleLog", () => {
  it("reads level, text and step attribution", () => {
    expect(parseConsoleLog(line({ level: "error", text: "boom", step: "2" }))).toEqual([{ level: "error", text: "boom", step: "2" }]);
  });

  it("defaults the level to log", () => {
    expect(parseConsoleLog(line({ text: "hello" }))[0]?.level).toBe("log");
  });

  it("lowercases the level", () => {
    expect(parseConsoleLog(line({ level: "ERROR", text: "x" }))[0]?.level).toBe("error");
  });

  it("normalizes warn to warning", () => {
    expect(parseConsoleLog(line({ level: "warn", text: "x" }))[0]?.level).toBe("warning");
    expect(parseConsoleLog(line({ level: "WARN", text: "x" }))[0]?.level).toBe("warning");
  });

  it.each(["level", "type", "severity"])("reads the level from %s", (key) => {
    expect(parseConsoleLog(line({ [key]: "error", text: "x" }))[0]?.level).toBe("error");
  });

  it.each(["text", "message", "msg"])("reads the text from %s", (key) => {
    expect(parseConsoleLog(line({ [key]: "the text" }))[0]?.text).toBe("the text");
  });

  it("joins console arguments into the text, stringifying objects", () => {
    expect(parseConsoleLog(line({ level: "error", args: ["failed:", { code: 7 }, 3] }))[0]?.text).toBe('failed: {"code":7} 3');
  });

  it("skips records without any text", () => {
    expect(parseConsoleLog(`${line({ level: "error" })}${line({ level: "error", args: [] })}${line({ text: "   " })}`)).toEqual([]);
  });

  it("skips lines that are not JSON objects", () => {
    expect(parseConsoleLog(`banner\n${line({ text: "kept" })}[1,2]\n`).map((e) => e.text)).toEqual(["kept"]);
  });

  it("cuts long text at 500 characters", () => {
    expect(parseConsoleLog(line({ text: "x".repeat(900) }))[0]?.text).toHaveLength(500);
  });

  it("redacts secrets in the text", () => {
    const text = parseConsoleLog(line({ level: "error", text: "fetch failed: token=abc123def" }))[0]?.text ?? "";
    expect(text).toBe("fetch failed: token=[redacted]");
  });

  it.each([
    ["step", { step: "7" }, "7"],
    ["step_id", { step_id: "abc" }, "abc"],
    ["stepIndex", { stepIndex: 3 }, "3"],
    ["ordinal", { ordinal: 4 }, "4"],
  ])("reads the step from %s", (_key, extra, expected) => {
    expect(parseConsoleLog(line({ text: "x", ...extra }))[0]?.step).toBe(expected);
  });

  it("leaves the step undefined when Kane recorded none", () => {
    expect(parseConsoleLog(line({ text: "x" }))[0]?.step).toBeUndefined();
  });

  it("keeps entries in log order", () => {
    const text = `${line({ text: "first" })}${line({ text: "second" })}`;
    expect(parseConsoleLog(text).map((e) => e.text)).toEqual(["first", "second"]);
  });
});

describe("isProblem", () => {
  it.each(["error", "warning", "assert"])("treats %s as a problem", (level) => {
    expect(isProblem({ level, text: "x" })).toBe(true);
  });

  it.each(["log", "info", "debug", "trace"])("does not treat %s as a problem", (level) => {
    expect(isProblem({ level, text: "x" })).toBe(false);
  });
});

describe("parseNetworkFailures", () => {
  const entry = (status: number, extra: Record<string, unknown> = {}) => ({
    request: { method: "GET", url: "http://localhost:4173/api/x" },
    response: { status, statusText: "text" },
    ...extra,
  });

  it("keeps HTTP errors from 400 up", () => {
    const failures = parseNetworkFailures(har([entry(399), entry(400), entry(404), entry(500)]));
    expect(failures.map((f) => f.status)).toEqual([400, 404, 500]);
  });

  it("skips successful and redirect responses", () => {
    expect(parseNetworkFailures(har([entry(200), entry(204), entry(301), entry(304)]))).toEqual([]);
  });

  it("reads method, URL and status text", () => {
    const failures = parseNetworkFailures(har([{ request: { method: "POST", url: "http://x/api" }, response: { status: 500, statusText: "Internal Server Error" } }]));
    expect(failures).toEqual([{ method: "POST", url: "http://x/api", status: 500, statusText: "Internal Server Error", step: undefined }]);
  });

  it("defaults the method to GET", () => {
    const failures = parseNetworkFailures(har([{ request: { url: "http://x/a" }, response: { status: 500 } }]));
    expect(failures[0]?.method).toBe("GET");
  });

  it("keeps a request that never got a response, as status 0", () => {
    const failures = parseNetworkFailures(har([{ request: { method: "GET", url: "http://x/a" }, response: { status: 0 } }]));
    expect(failures).toEqual([expect.objectContaining({ status: 0 })]);
  });

  it("keeps a request that has no response object at all", () => {
    expect(parseNetworkFailures(har([{ request: { url: "http://x/a" } }]))).toEqual([expect.objectContaining({ status: 0 })]);
  });

  it("keeps transport errors reported on the entry, using the error as status text", () => {
    const failures = parseNetworkFailures(har([{ request: { url: "http://x/a" }, response: { status: 0 }, _error: "net::ERR_CONNECTION_REFUSED" }]));
    expect(failures[0]).toMatchObject({ status: 0, statusText: "net::ERR_CONNECTION_REFUSED" });
  });

  it("keeps transport errors reported on the response, even with a success status", () => {
    const failures = parseNetworkFailures(har([{ request: { url: "http://x/a" }, response: { status: 200, _error: "net::ERR_ABORTED" } }]));
    expect(failures[0]).toMatchObject({ status: 200, statusText: "net::ERR_ABORTED" });
  });

  it("skips entries without a request URL", () => {
    expect(parseNetworkFailures(har([{ request: { method: "GET" }, response: { status: 500 } }]))).toEqual([]);
  });

  it("cuts very long URLs at 200 characters", () => {
    const failures = parseNetworkFailures(har([entry(500, { request: { url: `http://x/${"p".repeat(400)}` } })]));
    expect(failures[0]?.url).toHaveLength(201);
    expect(failures[0]?.url.endsWith("…")).toBe(true);
  });

  it("redacts secrets in URLs", () => {
    const failures = parseNetworkFailures(har([entry(401, { request: { url: "http://x/api?access_key=SECRET123&q=1" } })]));
    expect(failures[0]?.url).not.toContain("SECRET123");
  });

  it("reads step attribution from a direct step field", () => {
    expect(parseNetworkFailures(har([entry(500, { step: 3 })]))[0]?.step).toBe("3");
  });

  it("reads step attribution from a nested underscore-prefixed object", () => {
    expect(parseNetworkFailures(har([entry(500, { _kane: { step_id: "abc" } })]))[0]?.step).toBe("abc");
  });

  it("leaves the step undefined when there is no attribution", () => {
    expect(parseNetworkFailures(har([entry(500)]))[0]?.step).toBeUndefined();
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["a document without a log", "{}"],
    ["a log without entries", '{"log":{}}'],
    ["entries that are not an array", '{"log":{"entries":"nope"}}'],
    ["an empty string", ""],
  ])("returns nothing for %s", (_name, text) => {
    expect(parseNetworkFailures(text)).toEqual([]);
  });
});

describe("forStep", () => {
  const items = [
    { id: 1, step: "1" },
    { id: 2, step: "2" },
    { id: 3, step: "2" },
    { id: 4 },
    { id: 5, step: "3" },
  ];

  it("keeps only the entries attributed to the failing step", () => {
    expect(forStep(items, ["2"], 8).map((i) => i.id)).toEqual([2, 3]);
  });

  it("accepts any of several keys for the same step", () => {
    expect(forStep(items, ["0002", "2"], 8).map((i) => i.id)).toEqual([2, 3]);
  });

  it("falls back to every entry when none is attributed to the step", () => {
    expect(forStep(items, ["9"], 8).map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back to every entry when there are no step keys", () => {
    expect(forStep(items, [], 8)).toHaveLength(5);
  });

  it("keeps only the most recent entries up to the limit", () => {
    expect(forStep(items, [], 2).map((i) => i.id)).toEqual([4, 5]);
  });

  it("applies the limit to the attributed entries too", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i, step: "2" }));
    expect(forStep(many, ["2"], 8).map((i) => i.id)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("returns an empty list for no entries", () => {
    expect(forStep([], ["2"], 8)).toEqual([]);
  });
});
