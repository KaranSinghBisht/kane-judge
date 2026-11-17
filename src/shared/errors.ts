/**
 * Errors with messages that are safe to show to the user or to Claude:
 * no stack traces, no secrets, no raw environment dumps.
 */
export class KaneJudgeError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(message: string, code = "KANE_JUDGE_ERROR", hint?: string) {
    super(message);
    this.name = "KaneJudgeError";
    this.code = code;
    this.hint = hint;
  }
}

const SECRET_RULES: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [
    /\b(access[-_]?key|api[-_]?key|token|secret|password|passwd|authorization)(["']?\s*[:=]\s*["']?)([^\s"',;]+)/gi,
    "$1$2[redacted]",
  ],
  [/--(access-key|password|token)(\s+|=)\S+/gi, "--$1$2[redacted]"],
  [/\bLT_[A-Za-z0-9]{16,}\b/g, "[redacted]"],
];

/** Masks anything that looks like a credential. Applied to every external text we echo. */
export function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}

/** One-line, user-safe description of any thrown value. */
export function safeMessage(err: unknown): string {
  if (err instanceof KaneJudgeError) return redact(err.message);
  if (isErrnoException(err)) {
    const where = err.path ? ` (${err.path})` : "";
    return redact(`${err.code}${err.syscall ? ` during ${err.syscall}` : ""}${where}`);
  }
  if (err instanceof SyntaxError) return redact(`invalid JSON: ${err.message}`);
  if (err instanceof Error) return redact(err.message.split("\n")[0] ?? err.name);
  return "unexpected non-error value thrown";
}
