import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

let _marked: Marked | null = null;

function getMarked(width?: number): Marked {
  if (_marked && !width) return _marked;

  const instance = new Marked();
  instance.use(
    markedTerminal({
      width: width ?? process.stdout.columns ?? 80,
      reflowText: true,
      showSectionPrefix: false,
    }),
  );

  if (!width) _marked = instance;
  return instance;
}

/**
 * Render a markdown string to ANSI-styled terminal output.
 *
 * Uses `marked` with `marked-terminal` to produce styled text suitable
 * for display in a terminal. Supports headings, code blocks (with syntax
 * highlighting), lists, bold/italic, links, tables, and blockquotes.
 *
 * @param content - Raw markdown string.
 * @param width - Terminal width for text wrapping. Defaults to `process.stdout.columns` or 80.
 * @returns ANSI-styled string ready for terminal output.
 */
export function renderMarkdown(content: string, width?: number): string {
  const marked = getMarked(width);
  const result = marked.parse(content);
  if (typeof result !== "string") {
    return content;
  }
  return result.trimEnd();
}
