package toolrender

import (
	"bytes"
	"path/filepath"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
)

// highlightStyleName is the chroma style used for syntax highlighting in
// terminal output. "monokai" provides vibrant, high-contrast colors that work
// well on the dark terminal backgrounds most developers use.
//
// To preview styles: https://xyproto.github.io/splash/docs/
const highlightStyleName = "monokai"

// highlightFormatterName selects the terminal ANSI formatter. "terminal256"
// provides 256-color output that works on virtually all modern terminals
// (iTerm2, Terminal.app, Windows Terminal, Kitty, Alacritty, etc.) without
// requiring true-color support.
const highlightFormatterName = "terminal256"

// highlightContent applies syntax highlighting to file content based on the
// filename extension. It returns the highlighted content with embedded ANSI
// escape codes and a boolean indicating whether highlighting was applied.
//
// When highlighting is not possible (unknown extension, tokenization error, or
// formatter error), the original content is returned unchanged with false. This
// guarantees callers can always use the returned string — the fallback path
// never degrades content.
//
// The filename is used solely for lexer selection via chroma's filename
// matching (e.g., "foo.proto" -> ProtocolBuffer lexer). Only the base name
// matters; directory components are ignored.
func highlightContent(content, filename string) (string, bool) {
	if content == "" || filename == "" {
		return content, false
	}

	// Match lexer by filename. chroma inspects the extension and known
	// filename patterns (e.g., "Makefile", "Dockerfile").
	lexer := lexers.Match(filename)
	if lexer == nil {
		return content, false
	}

	// Coalesce runs of identical token types. This reduces the number of
	// ANSI escape sequences in the output, producing cleaner strings that
	// are cheaper to store and faster to render.
	lexer = chroma.Coalesce(lexer)

	style := styles.Get(highlightStyleName)
	if style == nil {
		style = styles.Fallback
	}

	formatter := formatters.Get(highlightFormatterName)
	if formatter == nil {
		return content, false
	}

	iterator, err := lexer.Tokenise(nil, content)
	if err != nil {
		return content, false
	}

	var buf bytes.Buffer
	if err := formatter.Format(&buf, style, iterator); err != nil {
		return content, false
	}

	highlighted := buf.String()

	// chroma's terminal formatter sometimes appends a trailing newline that
	// was not present in the original content. Strip it to preserve the
	// caller's line-splitting semantics.
	if !strings.HasSuffix(content, "\n") {
		highlighted = strings.TrimRight(highlighted, "\n")
	}

	return highlighted, true
}

// extractFilename retrieves the filename from tool call args, trying the
// primary "path" field and common fallbacks. Returns the base filename
// (without directory components) or an empty string if unavailable.
func extractFilename(args map[string]interface{}) string {
	path := extractPrimaryArgWithFallbacks(args, "path", []string{"file_path", "file"})
	if path == "" {
		return ""
	}
	return filepath.Base(path)
}
