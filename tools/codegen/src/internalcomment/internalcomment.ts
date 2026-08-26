// internalcomment owns the @internal proto-comment convention.
//
// Convention: a comment line that is exactly "@internal" (ignoring
// surrounding whitespace) marks the start of proto-source-only content —
// implementation notes, authorization details, storage strategy. That text
// is for developers reading the proto files and must never reach a
// generated surface: SDK type docs, MCP tool schemas (read by LLMs), the
// task registry, the docs site, or protoc-generated stubs (godoc / IDE
// hovers on published packages).
//
// The marker must be a full line: inline occurrences of "@internal" inside
// prose are left alone, matching how every proto in apis/ uses the
// convention.
//
// This module is the single owner of the marker semantics (oss#327
// established the single-owner rule; oss#497 extended coverage to stubs).
// It is a byte-parity port of the Go package at tools/codegen/internalcomment.
// Consumers:
//   - the schema-extraction plugin strips at extraction, so every
//     schema-driven generator receives SDK-facing text only.
//   - stubscrub strips protoc-generated stubs post-generation, the one
//     surface protoc writes without going through schema extraction.

/** Full-line sentinel that starts a proto-source-only section. */
export const MARKER = "@internal";

// Machine trailer lines that code generators append at the END of a doc
// block, after any prose (e.g. protoc-gen-es emits "@generated from field:
// string api_version = 1;"). Those lines are generator metadata, not
// internal prose, so a strip that removes an @internal section must keep
// them.
const GENERATED_TRAILER_PREFIX = "@generated";

// Go's strings.TrimSpace trims the Unicode White_Space set, which differs
// from JS String.prototype.trim at the margins (Go trims U+0085 NEL; JS
// additionally trims U+FEFF). Byte parity with the Go toolchain requires
// Go's exact set.
const GO_SPACE = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;

/** Exact equivalent of Go's strings.TrimSpace. */
export function goTrimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && GO_SPACE.test(s[start])) start++;
  while (end > start && GO_SPACE.test(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Reports whether line is a full-line @internal marker. */
export function isMarkerLine(line: string): boolean {
  return goTrimSpace(line) === MARKER;
}

/**
 * Applies the convention to a comment expressed as decoration-free text
 * lines (no "//", "*", or docstring quotes — callers strip and restore
 * their own comment syntax).
 *
 * Everything from the first marker line onward is dropped, except
 * @generated machine trailers, which are re-attached after a single blank
 * separator (mirroring how generators format them). Trailing blank lines
 * left dangling by the cut are trimmed. The second element reports whether
 * a marker was found; when false, lines is returned unmodified.
 */
export function stripLines(lines: readonly string[]): [string[], boolean] {
  let markerAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isMarkerLine(lines[i])) {
      markerAt = i;
      break;
    }
  }
  if (markerAt === -1) {
    return [lines.slice(), false];
  }

  const kept = trimTrailingBlank(lines.slice(0, markerAt));

  const trailers: string[] = [];
  for (const line of lines.slice(markerAt + 1)) {
    if (goTrimSpace(line).startsWith(GENERATED_TRAILER_PREFIX)) {
      trailers.push(line);
    }
  }

  if (trailers.length > 0) {
    if (kept.length > 0) {
      kept.push("");
    }
    kept.push(...trailers);
  }
  return [kept, true];
}

/**
 * Applies the convention to a comment expressed as one string of
 * newline-separated text lines and whitespace-trims the result. This is
 * the shape schema extraction works with.
 */
export function stripText(comment: string): string {
  const [lines, stripped] = stripLines(comment.split("\n"));
  if (!stripped) {
    return goTrimSpace(comment);
  }
  return goTrimSpace(lines.join("\n"));
}

function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && goTrimSpace(lines[end - 1]) === "") end--;
  return lines.slice(0, end);
}
