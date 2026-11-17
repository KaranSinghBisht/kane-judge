import { describe, expect, it } from "vitest";
import {
  arr,
  eventType,
  num,
  obj,
  parseNdjson,
  parseNdjsonLine,
  readErrorEvent,
  str,
} from "../src/kane/ndjson.js";
import { fixture } from "./helpers/events.js";

describe("parseNdjsonLine", () => {
  it("returns the object for a line holding a JSON object", () => {
    expect(parseNdjsonLine('{"type":"stream_start","v":1}')).toEqual({ type: "stream_start", v: 1 });
  });

  it("ignores surrounding whitespace and a trailing carriage return", () => {
    expect(parseNdjsonLine('  {"a":1}\r')).toEqual({ a: 1 });
  });

  it.each([
    ["a banner", "Kane CLI 0.10.5 (agent mode)"],
    ["an empty line", ""],
    ["a partial write missing its closing brace", '{"type":"testrun_done","overall_st'],
    ["braces around text that is not JSON", "{ not json }"],
    ["a JSON array", "[1,2,3]"],
    ["a bare JSON string", '"hello"'],
    ["a bare number", "42"],
  ])("returns undefined for %s", (_name, line) => {
    expect(parseNdjsonLine(line)).toBeUndefined();
  });

  it("keeps braces and escaped newlines that appear inside string values", () => {
    const line = JSON.stringify({ type: "x", text: "a } b\n{ c" });
    expect(parseNdjsonLine(line)).toEqual({ type: "x", text: "a } b\n{ c" });
  });
});

describe("parseNdjson", () => {
  it("returns no events and nothing skipped for empty input", () => {
    expect(parseNdjson("")).toEqual({ events: [], skipped: 0 });
  });

  it("keeps events in stream order", () => {
    const { events } = parseNdjson('{"n":1}\n{"n":2}\n{"n":3}\n');
    expect(events.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it("splits on CRLF as well as LF", () => {
    const { events, skipped } = parseNdjson('{"n":1}\r\n{"n":2}\r\n');
    expect(events).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("does not count blank lines as skipped", () => {
    expect(parseNdjson('\n\n{"n":1}\n   \n').skipped).toBe(0);
  });

  it("counts banners and partial lines as skipped", () => {
    const { events, skipped } = parseNdjson('banner\n{"n":1}\n{"n":2\n');
    expect(events).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("skips the banner and the truncated last line of a recorded testrun stream", () => {
    const { events, skipped } = parseNdjson(fixture("testrun-failed.ndjson"));
    expect(events).toHaveLength(11);
    expect(skipped).toBe(2);
  });

  it("parses every line of a complete recorded stream without skipping any", () => {
    const { events, skipped } = parseNdjson(fixture("testrun-passed.ndjson"));
    expect(events).toHaveLength(9);
    expect(skipped).toBe(0);
  });
});

describe("field readers", () => {
  const e = { type: "x", name: "kane", blank: "   ", n: 4.5, inf: null, nested: { a: 1 }, list: [1, 2] };

  it("eventType returns the type only when it is a string", () => {
    expect(eventType(e)).toBe("x");
    expect(eventType({ type: 3 })).toBeUndefined();
    expect(eventType({})).toBeUndefined();
  });

  it("str returns non-blank strings only", () => {
    expect(str(e, "name")).toBe("kane");
    expect(str(e, "blank")).toBeUndefined();
    expect(str(e, "n")).toBeUndefined();
    expect(str(e, "missing")).toBeUndefined();
  });

  it("num returns finite numbers only", () => {
    expect(num(e, "n")).toBe(4.5);
    expect(num(e, "name")).toBeUndefined();
    expect(num(e, "inf")).toBeUndefined();
    expect(num({ n: Number.POSITIVE_INFINITY }, "n")).toBeUndefined();
  });

  it("obj returns plain objects and rejects arrays and null", () => {
    expect(obj(e, "nested")).toEqual({ a: 1 });
    expect(obj(e, "list")).toBeUndefined();
    expect(obj(e, "inf")).toBeUndefined();
  });

  it("arr returns arrays and an empty array for anything else", () => {
    expect(arr(e, "list")).toEqual([1, 2]);
    expect(arr(e, "nested")).toEqual([]);
    expect(arr(e, "missing")).toEqual([]);
  });
});

describe("readErrorEvent", () => {
  it("reads code, message and remedy from an error event", () => {
    const event = { type: "error", code: "AUTH", message: "not signed in", remedy: "run kane-cli login" };
    expect(readErrorEvent(event)).toEqual({ code: "AUTH", message: "not signed in", remedy: "run kane-cli login" });
  });

  it("leaves missing fields undefined", () => {
    expect(readErrorEvent({ type: "error", message: "boom" })).toEqual({
      code: undefined,
      message: "boom",
      remedy: undefined,
    });
  });

  it("returns undefined for events of any other type", () => {
    expect(readErrorEvent({ type: "warning", message: "careful" })).toBeUndefined();
    expect(readErrorEvent({ message: "no type" })).toBeUndefined();
  });
});
