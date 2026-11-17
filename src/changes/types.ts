/** Project-relative posix path -> fingerprint ("deleted", a content hash, or size:mtime). */
export type FileMap = Record<string, string>;

/**
 * What the working tree looked like at a point in time.
 * - git: HEAD plus every file that differs from HEAD (cheap: only dirty files are hashed).
 * - walk: every file's size+mtime, for projects that are not git repositories.
 */
export type Snapshot =
  | { kind: "git"; head: string | null; files: FileMap }
  | { kind: "walk"; files: FileMap };

export interface ChangeSet {
  /** Changed project-relative paths (ignored paths already removed). */
  files: string[];
  /** True when changes could not be determined precisely; every flow should run. */
  unknown: boolean;
  /** What the change set was measured against. */
  baseline: "last-green" | "head" | "none";
}
