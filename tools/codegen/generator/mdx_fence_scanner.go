package main

import (
	"fmt"
	"strings"
)

// codeFence is one fenced code block extracted from a markdown/MDX source.
type codeFence struct {
	Path string // file the fence was found in
	Line int    // 1-based line number of the opening fence
	Lang string // first token of the info string, e.g. "yaml"
	Meta string // remainder of the info string after the language token
	Body string // fence content, opening-fence indentation stripped
}

// scanMarkdownFences extracts backtick code fences from markdown/MDX source
// following CommonMark fence semantics, which matter for correctness here:
//
//   - a fence opened with N backticks is only closed by a line of >= N
//     backticks, so a ````mdx block that *demonstrates* a ```yaml fence does
//     not leak an inner fence into the results;
//   - fences may be indented up to three spaces (e.g. inside list items);
//     that indentation is stripped from the body so YAML parses correctly.
//
// An unclosed fence is an error rather than a silent skip: a truncated block
// must fail the docs YAML gate loudly, not evade it.
func scanMarkdownFences(path, src string) ([]codeFence, error) {
	var fences []codeFence

	var (
		inFence    bool
		open       codeFence
		openTicks  int
		openIndent int
		body       []string
	)

	lines := strings.Split(src, "\n")
	for i, line := range lines {
		if !inFence {
			indent, ticks, info, ok := parseFenceOpening(line)
			if !ok {
				continue
			}
			lang, meta := splitInfoString(info)
			inFence = true
			openTicks = ticks
			openIndent = indent
			body = nil
			open = codeFence{Path: path, Line: i + 1, Lang: lang, Meta: meta}
			continue
		}

		if isFenceClosing(line, openTicks) {
			open.Body = strings.Join(body, "\n")
			if len(body) > 0 {
				open.Body += "\n"
			}
			fences = append(fences, open)
			inFence = false
			continue
		}

		body = append(body, stripIndent(line, openIndent))
	}

	if inFence {
		return nil, fmt.Errorf("%s:%d: unclosed code fence at end of file", path, open.Line)
	}
	return fences, nil
}

// parseFenceOpening reports whether line opens a backtick fence, returning the
// leading indent width, the backtick count, and the trailing info string.
// Per CommonMark, the info string of a backtick fence may not contain a
// backtick (that would be an inline code span, not a fence).
func parseFenceOpening(line string) (indent, ticks int, info string, ok bool) {
	indent = countLeadingSpaces(line)
	if indent > 3 {
		return 0, 0, "", false
	}
	rest := line[indent:]
	ticks = countLeadingBackticks(rest)
	if ticks < 3 {
		return 0, 0, "", false
	}
	info = strings.TrimSpace(rest[ticks:])
	if strings.Contains(info, "`") {
		return 0, 0, "", false
	}
	return indent, ticks, info, true
}

// isFenceClosing reports whether line closes a fence opened with openTicks
// backticks: up to three spaces of indent, at least openTicks backticks, and
// nothing but whitespace after them.
func isFenceClosing(line string, openTicks int) bool {
	indent := countLeadingSpaces(line)
	if indent > 3 {
		return false
	}
	rest := line[indent:]
	ticks := countLeadingBackticks(rest)
	if ticks < openTicks {
		return false
	}
	return strings.TrimSpace(rest[ticks:]) == ""
}

// splitInfoString splits a fence info string into the language token and the
// remaining metadata, e.g. `yaml no-validate="reason"` -> ("yaml", `no-validate="reason"`).
func splitInfoString(info string) (lang, meta string) {
	if info == "" {
		return "", ""
	}
	if idx := strings.IndexAny(info, " \t"); idx >= 0 {
		return info[:idx], strings.TrimSpace(info[idx+1:])
	}
	return info, ""
}

func countLeadingSpaces(s string) int {
	n := 0
	for n < len(s) && s[n] == ' ' {
		n++
	}
	return n
}

func countLeadingBackticks(s string) int {
	n := 0
	for n < len(s) && s[n] == '`' {
		n++
	}
	return n
}

// stripIndent removes up to width leading spaces, mirroring CommonMark's rule
// that content of an indented fence has the opening indentation removed.
func stripIndent(line string, width int) string {
	n := 0
	for n < width && n < len(line) && line[n] == ' ' {
		n++
	}
	return line[n:]
}
