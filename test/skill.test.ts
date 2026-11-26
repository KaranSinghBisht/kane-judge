import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_NAME, skillCommand } from "../src/cli/commands/skill.js";
import { useTempDirs } from "./helpers/tmp.js";

const makeDir = useTempDirs();

describe("kane-judge skill", () => {
  it("copies the judging skill into Codex's skills folder under the name kane-judge", async () => {
    const home = await makeDir();
    expect(await skillCommand("codex", { home })).toBe(0);
    const text = await readFile(join(home, ".codex", "skills", SKILL_NAME, "SKILL.md"), "utf8");
    expect(text).toMatch(/^---\nname: kane-judge\n/);
    expect(text).toContain("## Workflow");
  });

  it("knows where OpenCode keeps skills", async () => {
    const home = await makeDir();
    expect(await skillCommand("opencode", { home })).toBe(0);
    expect(await readFile(join(home, ".config", "opencode", "skills", SKILL_NAME, "SKILL.md"), "utf8")).toContain("name: kane-judge");
  });

  it("treats anything else as a skills folder, for agents it doesn't know by name", async () => {
    const dir = await makeDir();
    expect(await skillCommand(join(dir, "agent", "skills"), { home: dir })).toBe(0);
    expect(await readFile(join(dir, "agent", "skills", SKILL_NAME, "SKILL.md"), "utf8")).toContain("name: kane-judge");
  });

  it("asks for a target instead of guessing one", async () => {
    expect(await skillCommand(undefined)).toBe(2);
    expect(await skillCommand("--help")).toBe(2);
  });

  it("ships the same workflow the Claude Code plugin uses", async () => {
    const home = await makeDir();
    await skillCommand("codex", { home });
    const copied = await readFile(join(home, ".codex", "skills", SKILL_NAME, "SKILL.md"), "utf8");
    const source = await readFile(join(__dirname, "..", "skills", "judging", "SKILL.md"), "utf8");
    expect(copied).toBe(source.replace("name: judging", "name: kane-judge"));
  });
});
