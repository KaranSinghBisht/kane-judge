import { describe, expect, it } from "vitest";
import { buildTestrunArgs, evidenceHint, stderrTail } from "../src/kane/runner.js";
import { makeConfig, makeFlow } from "./helpers/builders.js";

const FLOWS = [makeFlow("checkout"), makeFlow("admin/users")];

describe("buildTestrunArgs", () => {
  it("runs every flow file in one agent-mode execution with the configured parallelism", () => {
    expect(buildTestrunArgs(FLOWS, makeConfig(), "judge")).toEqual([
      "testrun",
      "run",
      "kane/flows/checkout_test.md",
      "kane/flows/admin/users_test.md",
      "--agent",
      "--parallel",
      "2",
      "--headless",
      "--name",
      "judge",
    ]);
  });

  it("omits --headless when headless is off", () => {
    expect(buildTestrunArgs(FLOWS, makeConfig({ headless: false }), "judge")).not.toContain("--headless");
  });

  it("passes the parallel worker count as its own argument", () => {
    const args = buildTestrunArgs(FLOWS, makeConfig({ parallel: 5 }), "judge");
    expect(args[args.indexOf("--parallel") + 1]).toBe("5");
  });

  it.each(["off", "stop", "continue"] as const)("passes --bug-detection %s through", (mode) => {
    const args = buildTestrunArgs(FLOWS, makeConfig({ bugDetection: mode }), "judge");
    expect(args[args.indexOf("--bug-detection") + 1]).toBe(mode);
  });

  it("omits --bug-detection when it is not configured", () => {
    expect(buildTestrunArgs(FLOWS, makeConfig(), "judge")).not.toContain("--bug-detection");
  });

  it("replaces every character outside [A-Za-z0-9_-] in the label with a dash", () => {
    const args = buildTestrunArgs(FLOWS, makeConfig(), "pr #42: fix/login");
    expect(args[args.indexOf("--name") + 1]).toBe("pr--42--fix-login");
  });

  it("keeps shell metacharacters in the label as inert text in a single argument", () => {
    const args = buildTestrunArgs(FLOWS, makeConfig(), "a; rm -rf / $(id)");
    expect(args[args.indexOf("--name") + 1]).toBe("a--rm--rf-----id-");
  });

  it("caps the label at 60 characters", () => {
    const args = buildTestrunArgs(FLOWS, makeConfig(), "x".repeat(100));
    expect(args[args.indexOf("--name") + 1]).toHaveLength(60);
  });

  it("leaves out --name when the label is empty", () => {
    expect(buildTestrunArgs(FLOWS, makeConfig(), "")).not.toContain("--name");
  });

  it("produces no flow arguments for an empty flow list", () => {
    expect(buildTestrunArgs([], makeConfig(), "judge").slice(0, 3)).toEqual(["testrun", "run", "--agent"]);
  });
});

describe("stderrTail", () => {
  it("strips ANSI colour codes", () => {
    expect(stderrTail("\u001b[31mError:\u001b[0m login failed")).toBe("Error: login failed");
  });

  it("strips cursor and erase sequences with parameters", () => {
    expect(stderrTail("\u001b[2K\u001b[1Gspinner done")).toBe("spinner done");
  });

  it("drops lines made only of box-drawing characters", () => {
    const boxed = ["╭──────────────╮", "│              │", "│ Please sign in │", "╰──────────────╯"].join("\n");
    expect(stderrTail(boxed)).toBe("│ Please sign in │");
  });

  it("drops blank and whitespace-only lines", () => {
    expect(stderrTail("first\n\n   \nsecond\n")).toBe("first\nsecond");
  });

  it("trims trailing whitespace from each line", () => {
    expect(stderrTail("first   \nsecond\t")).toBe("first\nsecond");
  });

  it("handles CRLF line endings", () => {
    expect(stderrTail("first\r\nsecond\r\n")).toBe("first\nsecond");
  });

  it("keeps only the last 12 lines by default", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const tail = stderrTail(lines.join("\n")).split("\n");
    expect(tail).toHaveLength(12);
    expect(tail[0]).toBe("line 9");
    expect(tail[11]).toBe("line 20");
  });

  it("honours a custom line limit", () => {
    expect(stderrTail("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("returns an empty string when there is nothing meaningful", () => {
    expect(stderrTail("")).toBe("");
    expect(stderrTail("╭───╮\n╰───╯\n")).toBe("");
  });

  it("redacts bearer tokens", () => {
    expect(stderrTail("GET /me failed: Bearer abc.def-123")).toBe("GET /me failed: Bearer [redacted]");
  });

  it("redacts access keys passed as a flag", () => {
    expect(stderrTail("kane-cli login --access-key s3cr3tvalue")).toBe("kane-cli login --access-key [redacted]");
  });

  it("redacts key=value credentials", () => {
    expect(stderrTail("using access_key=AKIA123456 for upload")).toBe("using access_key=[redacted] for upload");
  });

  it("redacts LambdaTest-style tokens", () => {
    const output = stderrTail("token LT_ABCDEFGHIJKLMNOP1234 rejected");
    expect(output).not.toContain("LT_ABCDEFGHIJKLMNOP1234");
    expect(output).toContain("[redacted]");
  });

  it("redacts secrets that sit in the retained lines only", () => {
    const secretFirst = ["password=hunter2", ...Array.from({ length: 12 }, (_, i) => `ok ${i}`)].join("\n");
    expect(stderrTail(secretFirst)).not.toContain("hunter2");
  });
});

describe("evidenceHint", () => {
  const HINT = "evidence: view locally with `kane-cli evidence serve /work/app/.testmuai/evidence/exec-1.evidence`";

  it("extracts the evidence path from Kane's stderr hint", () => {
    expect(evidenceHint(`run sealed\n${HINT}\n`)).toBe("/work/app/.testmuai/evidence/exec-1.evidence");
  });

  it("strips ANSI codes before matching", () => {
    const colored = HINT.replace("kane-cli", "\u001b[36mkane-cli\u001b[0m");
    expect(evidenceHint(colored)).toBe("/work/app/.testmuai/evidence/exec-1.evidence");
  });

  it("keeps a path that contains spaces whole", () => {
    expect(evidenceHint("`kane-cli evidence serve /Users/dev/My Project/x.evidence`")).toBe("/Users/dev/My Project/x.evidence");
  });

  it("returns undefined when stderr has no hint", () => {
    expect(evidenceHint("nothing to see here")).toBeUndefined();
  });

  it("returns undefined when the hint is not closed by a backtick", () => {
    expect(evidenceHint("kane-cli evidence serve /tmp/x.evidence")).toBeUndefined();
  });
});
