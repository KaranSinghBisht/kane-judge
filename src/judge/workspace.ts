import { join, resolve } from "node:path";

/** Where an event's projects live, relative to the folder Claude is judging from. */
export const PROJECTS_DIR = "projects";

/** Every file Kane Judge reads or writes for one project. */
export interface ProjectPaths {
  dir: string;
  /** Kane flows Claude writes, one per claim (`flows/<name>_test.md`). */
  flowsDir: string;
  /** Screenshots extracted from Kane's evidence packs. */
  evidenceDir: string;
  /** What the submission says (untrusted text, written by `scan`). */
  submission: string;
  /** Repo facts and links (written by `scan`). */
  scan: string;
  /** Kane's results across runs (written by `run`). */
  results: string;
  /** Claude's judgement (written by Claude, read by `report`). */
  verdict: string;
  reportMd: string;
  scorecardHtml: string;
}

export function projectPaths(dir: string): ProjectPaths {
  const abs = resolve(dir);
  return {
    dir: abs,
    flowsDir: join(abs, "flows"),
    evidenceDir: join(abs, "evidence"),
    submission: join(abs, "submission.md"),
    scan: join(abs, "scan.json"),
    results: join(abs, "kane-results.json"),
    verdict: join(abs, "verdict.json"),
    reportMd: join(abs, "report.md"),
    scorecardHtml: join(abs, "scorecard.html"),
  };
}

/** "My Cool-Project!!" -> "my-cool-project" (a-z, 0-9 and dashes, at most 48 characters). */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "project";
}
