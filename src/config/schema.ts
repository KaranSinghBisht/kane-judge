/** kane-gate.json, after validation and defaults. */
export interface KaneGateConfig {
  /** Where the app under test is served, e.g. http://localhost:4173. */
  url: string;
  /** Optional command (argv, no shell) that starts the app when `url` is not reachable. */
  devCommand?: string[];
  /** URL polled for readiness; defaults to `url`. */
  readyUrl?: string;
  readyTimeoutSec: number;
  /** Directory (relative to the project) holding Kane `_test.md` flows. */
  flowsDir: string;
  /** Per-flow file mappings: flow name -> globs of project files it covers. Unlisted flows cover everything. */
  flows: Record<string, FlowMapping>;
  /** Globs that never count as app changes (in addition to built-in ones). */
  ignore: string[];
  /** Failed verification attempts per round before the gate lets Claude stop and asks for a human. */
  maxAttempts: number;
  headless: boolean;
  /** Wall-clock limit for one Kane run, in seconds. */
  timeoutSec: number;
  /** Parallel Chrome workers for `kane-cli testrun run`. */
  parallel: number;
  /** Deny agent edits to flow files, kane-gate.json and .kane-gate/. */
  lockFlows: boolean;
  /** Ask Claude to add a flow when changed files match no flow mapping. */
  coverageNudge: boolean;
  /** kane-cli executable (resolved on PATH, spawned without a shell). */
  kaneBin: string;
  /** Passed through as `--bug-detection` when set. */
  bugDetection?: "off" | "stop" | "continue";
}

export interface FlowMapping {
  paths: string[];
}

export const CONFIG_FILE = "kane-gate.json";
export const STATE_DIR = ".kane-gate";

export const DEFAULTS = {
  readyTimeoutSec: 60,
  flowsDir: "kane/flows",
  maxAttempts: 3,
  headless: true,
  timeoutSec: 900,
  parallel: 2,
  lockFlows: true,
  coverageNudge: true,
  kaneBin: "kane-cli",
} as const;

/** Stop hooks may block at most 8 times in a row before Claude Code overrides them. */
export const MAX_ATTEMPTS_CEILING = 7;

/** Paths that are never "app changes": our own state, Kane artifacts, editor/agent config. */
export const BUILTIN_IGNORES: readonly string[] = [
  ".kane-gate/**",
  ".testmuai/**",
  "**/.testmuai/**",
  "**/output-*/**",
  "**/helper-output-*/**",
  ".claude/**",
  ".git/**",
  "**/node_modules/**",
  "**/.DS_Store",
  ".hyperexecute/**",
  "hyperexecute-cli.log",
  ".updatedhyperexecute.yaml",
  // Coding-agent and editor state that tools write into the project.
  "**/.omc/**",
  ".cursor/**",
  ".codex/**",
  ".gemini/**",
  ".kiro/**",
  ".windsurf/**",
  ".vscode/**",
  ".idea/**",
  "**/*.log",
];
