// Scrub logic for stubscrub: removes @internal comment sections from
// protoc-generated stubs.
//
// protoc copies proto leading comments into generated code verbatim, which
// makes the stubs the one generated surface the schema-extraction strip
// cannot reach (oss#497). These functions apply the convention — owned by
// src/internalcomment — to the generated files themselves: everything from
// a full-line "@internal" marker to the end of its comment block is
// dropped, except @generated machine trailers, which generators place at
// the end of doc blocks and tooling greps for.
//
// Each scrubber handles one comment syntax; kept lines are re-emitted with
// the block's own decoration so untouched bytes stay untouched. The Go, TS
// and Python scrubbers are a byte-parity port of the retired Go tool.
//
// Java needs its own handling: protoc-java and grpc-java copy the proto
// comment into javadoc inside a <pre> span and HTML-escape "@" as "&#64;",
// so the marker arrives as "&#64;internal". The escape is javadoc syntax,
// not part of the convention, so it is recognised here and the marker
// semantics stay with src/internalcomment.

import { goTrimSpace, MARKER, stripLines } from "../internalcomment/internalcomment.js";

/** The marker as protoc-java writes it into javadoc ("@" escaped). */
export const JAVA_ESCAPED_MARKER = "&#64;internal";

export type Scrubber = (data: string) => [out: string, changed: boolean];

/** Selects the scrubber for a file path by extension, or null to skip. */
export function scrubberFor(path: string): Scrubber | null {
  if (path.endsWith(".go")) return scrubGo;
  if (path.endsWith(".ts")) return scrubTs;
  if (path.endsWith(".py")) return scrubPy;
  if (path.endsWith(".java")) return scrubJava;
  return null;
}

// scrubGo handles protoc-gen-go(-grpc) output: contiguous runs of "//" line
// comments. Only blocks containing a marker are rewritten; kept lines are
// re-emitted with the block's own "//" prefix.
export function scrubGo(data: string): [string, boolean] {
  const lines = data.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; ) {
    if (!isGoComment(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isGoComment(lines[i])) i++;
    const block = lines.slice(start, i);

    const [prefix, texts] = goBlockTexts(block);
    const [kept, stripped] = stripLines(texts);
    if (!stripped) {
      out.push(...block);
      continue;
    }
    changed = true;
    for (const text of kept) {
      out.push(text === "" ? prefix : prefix + " " + text);
    }
  }

  if (!changed) return [data, false];
  return [out.join("\n"), true];
}

function isGoComment(line: string): boolean {
  return goTrimSpace(line).startsWith("//");
}

// goBlockTexts splits a "//" block into its shared prefix (indentation plus
// "//", taken from the first line) and the per-line comment text.
function goBlockTexts(block: string[]): [prefix: string, texts: string[]] {
  const idx = block[0].indexOf("//");
  const prefix = block[0].slice(0, idx + 2);
  const texts = block.map((line) => {
    const j = line.indexOf("//");
    return trimOneLeadingSpace(line.slice(j + 2));
  });
  return [prefix, texts];
}

// scrubTs handles protoc-gen-es output: "/** ... */" JSDoc blocks. Kept
// lines are re-emitted as INDENT + " * " + text; a block reduced to nothing
// is removed entirely.
export function scrubTs(data: string): [string, boolean] {
  const lines = data.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; ) {
    if (goTrimSpace(lines[i]) !== "/**") {
      out.push(lines[i]);
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < lines.length && goTrimSpace(lines[i]) !== "*/") i++;
    if (i === lines.length) {
      // Unterminated block: leave untouched.
      out.push(...lines.slice(start));
      break;
    }
    const closing = lines[i];
    i++;
    const middle = lines.slice(start + 1, i - 1);

    const texts = middle.map(tsCommentText);
    const [kept, stripped] = stripLines(texts);
    if (!stripped) {
      out.push(...lines.slice(start, i));
      continue;
    }
    changed = true;
    if (kept.length === 0) {
      continue; // fully internal block: drop it, including the fences
    }
    const indent = lines[start].slice(0, lines[start].indexOf("/**"));
    out.push(lines[start]);
    for (const text of kept) {
      out.push(text === "" ? indent + " *" : indent + " * " + text);
    }
    out.push(closing);
  }

  if (!changed) return [data, false];
  return [out.join("\n"), true];
}

// Strips javadoc-style "*" decoration; scrubJava shares it.
function tsCommentText(line: string): string {
  let trimmed = goTrimSpace(line);
  if (trimmed.startsWith("*")) trimmed = trimmed.slice(1);
  return trimOneLeadingSpace(trimmed);
}

// scrubJava handles protoc-java and grpc-java output: "/** ... */" javadoc
// blocks whose proto comment sits in one " * <pre>" ... " * </pre>" span.
// grpc-java may put its own prose before the span, and the span is followed
// by generator trailers ("Protobuf type", "<code>", "@return") or by the
// block's close. Only the span's lines are rewritten, as scrubTs rewrites a
// JSDoc body; everything outside it is emitted untouched. A span reduced to
// nothing is dropped with the " *" separator after it, which leaves the
// shape protoc-java emits for an uncommented element, and a block left
// empty is dropped entirely. Blocks without a terminated span are not
// protoc output and are left alone.
export function scrubJava(data: string): [string, boolean] {
  const lines = data.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; ) {
    if (goTrimSpace(lines[i]) !== "/**") {
      out.push(lines[i]);
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < lines.length && goTrimSpace(lines[i]) !== "*/") i++;
    if (i === lines.length) {
      // Unterminated block: leave untouched.
      out.push(...lines.slice(start));
      break;
    }
    i++;
    const block = lines.slice(start, i);

    const scrubbed = scrubJavadocBlock(block);
    if (scrubbed === null) {
      out.push(...block);
      continue;
    }
    changed = true;
    out.push(...scrubbed);
  }

  if (!changed) return [data, false];
  return [out.join("\n"), true];
}

// scrubJavadocBlock returns the block without its internal section, or null
// when the block has no terminated <pre> span carrying a marker. The block
// runs from its "/**" line to its "*/" line inclusive.
function scrubJavadocBlock(block: string[]): string[] | null {
  const open = block.findIndex((line) => goTrimSpace(line) === "* <pre>");
  if (open === -1) return null;
  let close = open + 1;
  while (close < block.length - 1 && goTrimSpace(block[close]) !== "* </pre>") close++;
  if (close === block.length - 1) return null;

  const texts = block.slice(open + 1, close).map((line) => {
    const text = tsCommentText(line);
    return goTrimSpace(text) === JAVA_ESCAPED_MARKER ? MARKER : text;
  });
  const [kept, stripped] = stripLines(texts);
  if (!stripped) return null;

  const indent = block[0].slice(0, block[0].indexOf("/**"));
  const head = block.slice(0, open);
  let tail = block.slice(close + 1);
  if (kept.length > 0) {
    const body = kept.map((text) => (text === "" ? indent + " *" : indent + " * " + text));
    return [...head, block[open], ...body, block[close], ...tail];
  }
  if (tail.length > 1 && goTrimSpace(tail[0]) === "*") tail = tail.slice(1);
  if (head.length === 1 && tail.length === 1) return [];
  return [...head, ...tail];
}

// scrubPy handles grpc-python output: method docstrings in *_pb2_grpc.py.
// Docstring body lines are kept verbatim (they carry their own
// indentation), so only the cut itself is synthesized.
export function scrubPy(data: string): [string, boolean] {
  const lines = data.split("\n");
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; ) {
    const trimmed = goTrimSpace(lines[i]);
    if (!trimmed.startsWith('"""') || isSingleLineDocstring(trimmed)) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < lines.length && !goTrimSpace(lines[i]).endsWith('"""')) i++;
    if (i === lines.length) {
      // Unterminated: leave untouched.
      out.push(...lines.slice(start));
      break;
    }
    const closing = lines[i];
    i++;
    const middle = lines.slice(start + 1, i - 1);

    const [kept, stripped] = stripLines(middle);
    if (!stripped) {
      out.push(...lines.slice(start, i));
      continue;
    }
    changed = true;
    out.push(lines[start], ...kept, closing);
  }

  if (!changed) return [data, false];
  return [out.join("\n"), true];
}

function isSingleLineDocstring(trimmed: string): boolean {
  return trimmed.length >= 6 && trimmed.endsWith('"""') && trimmed !== '"""';
}

// Go's strings.TrimPrefix(s, " ") removes at most ONE leading space —
// deliberately not a trim, so deeper indentation inside comments survives.
function trimOneLeadingSpace(s: string): string {
  return s.startsWith(" ") ? s.slice(1) : s;
}
