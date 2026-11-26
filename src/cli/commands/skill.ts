import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeMessage } from "../../shared/errors.js";
import { out } from "../../shared/logger.js";

/** The folder and skill name other agents see. Claude Code gets the skill through the plugin instead. */
export const SKILL_NAME = "kane-judge";

/** Where each agent keeps personal skills, relative to the home folder. */
const AGENT_SKILL_DIRS: Record<string, string[]> = {
  codex: [".codex", "skills"],
  opencode: [".config", "opencode", "skills"],
};

const USAGE = `usage: kane-judge skill <${Object.keys(AGENT_SKILL_DIRS).join("|")}|skills-folder>
  Copy the judging skill into another coding agent's skills folder.
  Claude Code doesn't need this: install the plugin instead.`;

type SkillOptions = { home?: string };

/** The skill that ships with Kane Judge, found from wherever this file runs (the bundle in dist/, or src/ in tests). */
async function bundledSkill(): Promise<{ text: string; root: string } | undefined> {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const up of ["..", "../../.."]) {
    const root = resolve(here, up);
    const text = await readFile(join(root, "skills", "judging", "SKILL.md"), "utf8").catch(() => undefined);
    if (text !== undefined) return { text, root };
  }
  return undefined;
}

function skillsFolder(target: string, home: string): string {
  const known = AGENT_SKILL_DIRS[target.toLowerCase()];
  return known ? join(home, ...known) : resolve(target);
}

/**
 * `kane-judge skill <agent>`: the workflow is one SKILL.md and this CLI, so any
 * agent that reads skills and runs shell commands can judge. This copies the
 * skill where that agent looks for it, under a name that says what it is.
 */
export async function skillCommand(target: string | undefined, options: SkillOptions = {}): Promise<number> {
  if (!target || target.startsWith("-")) {
    out(USAGE);
    return 2;
  }
  const skill = await bundledSkill();
  if (!skill) {
    out("kane-judge skill: the judging skill is missing from this install (skills/judging/SKILL.md).");
    return 2;
  }
  const dest = join(skillsFolder(target, options.home ?? homedir()), SKILL_NAME);
  const text = skill.text.replace(/^name: judging$/m, `name: ${SKILL_NAME}`);
  try {
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, "SKILL.md"), text, "utf8");
  } catch (err) {
    out(`kane-judge skill: could not write ${dest}: ${safeMessage(err)}`);
    return 2;
  }
  out(`Installed the ${SKILL_NAME} skill in ${dest}.
Keep kane-judge on the agent's PATH: export PATH="${join(skill.root, "bin")}:$PATH"
Then ask the agent: Use the ${SKILL_NAME} skill to judge <repo or submission url> --live <demo url>
The checker in \`kane-judge report\` is the same in every agent. The hook that stops an agent editing Kane's record is Claude Code only.`);
  return 0;
}
