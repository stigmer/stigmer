// Fenced-code-block extraction from markdown/MDX following CommonMark fence
// semantics (port of mdx_fence_scanner.go):
//
//   - a fence opened with N backticks is only closed by a line of >= N
//     backticks, so a ````mdx block that *demonstrates* a ```yaml fence does
//     not leak an inner fence into the results;
//   - fences may be indented up to three spaces (e.g. inside list items);
//     that indentation is stripped from the body so YAML parses correctly.
//
// An unclosed fence is an error rather than a silent skip: a truncated block
// must fail the docs YAML gate loudly, not evade it.

import { goTrimSpace } from "../internalcomment/internalcomment.js";

export interface CodeFence {
  path: string;
  line: number;
  lang: string;
  meta: string;
  body: string;
}

export function scanMarkdownFences(path: string, src: string): CodeFence[] {
  const fences: CodeFence[] = [];

  let inFence = false;
  let open: CodeFence = { path, line: 0, lang: "", meta: "", body: "" };
  let openTicks = 0;
  let openIndent = 0;
  let body: string[] = [];

  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const opening = parseFenceOpening(line);
      if (opening === null) continue;
      const [indent, ticks, info] = opening;
      const [lang, meta] = splitInfoString(info);
      inFence = true;
      openTicks = ticks;
      openIndent = indent;
      body = [];
      open = { path, line: i + 1, lang, meta, body: "" };
      continue;
    }

    if (isFenceClosing(line, openTicks)) {
      open.body = body.join("\n");
      if (body.length > 0) {
        open.body += "\n";
      }
      fences.push(open);
      inFence = false;
      continue;
    }

    body.push(stripIndent(line, openIndent));
  }

  if (inFence) {
    throw new Error(`${path}:${open.line}: unclosed code fence at end of file`);
  }
  return fences;
}

// Per CommonMark, the info string of a backtick fence may not contain a
// backtick (that would be an inline code span, not a fence).
function parseFenceOpening(line: string): [indent: number, ticks: number, info: string] | null {
  const indent = countLeadingSpaces(line);
  if (indent > 3) return null;
  const rest = line.slice(indent);
  const ticks = countLeadingBackticks(rest);
  if (ticks < 3) return null;
  const info = goTrimSpace(rest.slice(ticks));
  if (info.includes("`")) return null;
  return [indent, ticks, info];
}

function isFenceClosing(line: string, openTicks: number): boolean {
  const indent = countLeadingSpaces(line);
  if (indent > 3) return false;
  const rest = line.slice(indent);
  const ticks = countLeadingBackticks(rest);
  if (ticks < openTicks) return false;
  return goTrimSpace(rest.slice(ticks)) === "";
}

function splitInfoString(info: string): [lang: string, meta: string] {
  if (info === "") return ["", ""];
  const idx = info.search(/[ \t]/);
  if (idx >= 0) {
    return [info.slice(0, idx), goTrimSpace(info.slice(idx + 1))];
  }
  return [info, ""];
}

function countLeadingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === " ") n++;
  return n;
}

function countLeadingBackticks(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === "`") n++;
  return n;
}

function stripIndent(line: string, width: number): string {
  let n = 0;
  while (n < width && n < line.length && line[n] === " ") n++;
  return line.slice(n);
}
