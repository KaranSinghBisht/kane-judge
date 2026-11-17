/**
 * Untrusted text inside Markdown: escape the characters that create links,
 * images, emphasis, code, tables and headings, neutralise raw HTML, and keep
 * everything on one line.
 */
export function mdText(text: string | number | undefined): string {
  return String(text ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/[\\`*_[\]()!#|~]/g, (c) => `\\${c}`)
    .replace(/</g, "‹")
    .replace(/>/g, "›");
}
