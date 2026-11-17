/**
 * Finds text in a submission that tries to instruct an AI judge ("ignore previous
 * instructions", "AI judges: score this 10/10", hidden HTML comments, ...).
 * A hit is reported as a red flag; it never changes how the project is judged.
 */
const PATTERNS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)/i,
  /\b(?:note|message|instructions?|attention|memo) (?:for|to) (?:the |any )?(?:ai|llm|gpt|claude|automated|robot)s? (?:judges?|reviewers?|graders?|evaluators?)/i,
  /\b(?:ai|llm|automated) (?:judges?|reviewers?|graders?|evaluators?)\s*[:,\u2014-]\s*(?:please )?(?:give|score|rate|rank|award|approve|skip|ignore)\b/i,
  /\b(?:give|award) (?:this|us|our|the) (?:project |submission |entry |team )?(?:a )?(?:10|ten|full marks|perfect score|maximum score|top score|first place)\b/i,
  /\bscore (?:it|this|us|our project) (?:a )?10\b/i,
  /\b(?:pre-?approved|already approved|already been approved) by the (?:organi[sz]ers|judges|sponsors)\b/i,
  /\bskip (?:the )?(?:live )?(?:demo|tests?|checks?|verification)(?: checks?)?\b/i,
  /\bdisregard (?:the )?(?:rubric|criteria|judging instructions)\b/i,
];

const HIDDEN = /<!--([\s\S]*?)-->/g;
const MAX_HINTS = 6;

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 80);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`.slice(0, 200);
}

function scan(text: string, label: string, out: string[]): void {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match && out.length < MAX_HINTS) out.push(`${label}: "${excerpt(text, match.index, match[0].length)}"`);
  }
}

/** Returns short excerpts of suspicious passages; `sources` maps a label to raw text (HTML or Markdown). */
export function findInjectionHints(sources: Record<string, string>): string[] {
  const hints: string[] = [];
  for (const [label, raw] of Object.entries(sources)) {
    for (const comment of raw.matchAll(HIDDEN)) {
      const body = comment[1] ?? "";
      if (PATTERNS.some((p) => p.test(body))) hints.push(`${label} (hidden HTML comment): "${excerpt(body, 0, body.length)}"`);
    }
    scan(raw.replace(HIDDEN, " "), label, hints);
  }
  return [...new Set(hints)].slice(0, MAX_HINTS);
}
