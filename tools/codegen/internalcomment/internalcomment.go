// Package internalcomment owns the @internal proto-comment convention.
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
// This package is the single owner of the marker semantics (oss#327
// established the single-owner rule; oss#497 extended coverage to stubs).
// Consumers:
//   - proto2schema strips at schema extraction, so every schema-driven
//     generator receives SDK-facing text only.
//   - stubscrub strips protoc-generated stubs post-generation, the one
//     surface protoc writes without going through proto2schema.
package internalcomment

import "strings"

// Marker is the full-line sentinel that starts a proto-source-only section.
const Marker = "@internal"

// generatedTrailerPrefix identifies machine trailer lines that code
// generators append at the END of a doc block, after any prose (e.g.
// protoc-gen-es emits "@generated from field: string api_version = 1;").
// Those lines are generator metadata, not internal prose, so a strip that
// removes an @internal section must keep them.
const generatedTrailerPrefix = "@generated"

// IsMarkerLine reports whether line is a full-line @internal marker.
func IsMarkerLine(line string) bool {
	return strings.TrimSpace(line) == Marker
}

// StripLines applies the convention to a comment expressed as
// decoration-free text lines (no "//", "*", or docstring quotes — callers
// strip and restore their own comment syntax).
//
// Everything from the first marker line onward is dropped, except
// @generated machine trailers, which are re-attached after a single blank
// separator (mirroring how generators format them). Trailing blank lines
// left dangling by the cut are trimmed. The second return value reports
// whether a marker was found; when false, lines is returned unmodified.
func StripLines(lines []string) ([]string, bool) {
	markerAt := -1
	for i, line := range lines {
		if IsMarkerLine(line) {
			markerAt = i
			break
		}
	}
	if markerAt == -1 {
		return lines, false
	}

	kept := trimTrailingBlank(lines[:markerAt])

	var trailers []string
	for _, line := range lines[markerAt+1:] {
		if strings.HasPrefix(strings.TrimSpace(line), generatedTrailerPrefix) {
			trailers = append(trailers, line)
		}
	}

	if len(trailers) > 0 {
		if len(kept) > 0 {
			kept = append(kept, "")
		}
		kept = append(kept, trailers...)
	}
	return kept, true
}

// StripText applies the convention to a comment expressed as one string of
// newline-separated text lines and whitespace-trims the result. This is the
// shape proto2schema works with.
func StripText(comment string) string {
	lines, stripped := StripLines(strings.Split(comment, "\n"))
	if !stripped {
		return strings.TrimSpace(comment)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func trimTrailingBlank(lines []string) []string {
	end := len(lines)
	for end > 0 && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	return lines[:end]
}
