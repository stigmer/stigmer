package mdrender

import (
	"strings"
	"sync"

	"charm.land/glamour/v2"
	"charm.land/glamour/v2/styles"
)

// rendererCache stores glamour.TermRenderer instances keyed by terminal width.
// Terminal width rarely changes, so caching avoids repeated renderer creation
// on every AI message render call.
var rendererCache sync.Map

// Render converts markdown content to ANSI-styled terminal text suitable for
// display in a terminal emulator. Width controls word wrapping; pass 0 to
// disable wrapping.
//
// The function never returns an error. If glamour fails for any reason, the
// raw content is returned unmodified. This guarantee prevents a rendering
// library from ever breaking the CLI's core display path.
func Render(content string, width int) string {
	if content == "" {
		return ""
	}

	r, err := getOrCreateRenderer(width)
	if err != nil {
		return content
	}

	rendered, err := r.Render(content)
	if err != nil {
		return content
	}

	return trimTrailingWhitespace(rendered)
}

// HasMarkdown reports whether content contains markdown syntax that would
// produce visually different output when rendered. Used by callers to decide
// between inline prefix ("🤖 Agent: text") and block prefix ("🤖 Agent:\n").
func HasMarkdown(content string) bool {
	if content == "" {
		return false
	}
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "# ") ||
			strings.HasPrefix(trimmed, "## ") ||
			strings.HasPrefix(trimmed, "### ") ||
			strings.HasPrefix(trimmed, "- ") ||
			strings.HasPrefix(trimmed, "* ") ||
			strings.HasPrefix(trimmed, "```") ||
			strings.HasPrefix(trimmed, "1. ") ||
			strings.HasPrefix(trimmed, "> ") ||
			strings.Contains(trimmed, "**") ||
			strings.HasPrefix(trimmed, "---") {
			return true
		}
	}
	return false
}

func getOrCreateRenderer(width int) (*glamour.TermRenderer, error) {
	if cached, ok := rendererCache.Load(width); ok {
		return cached.(*glamour.TermRenderer), nil
	}

	opts := []glamour.TermRendererOption{
		glamour.WithStyles(styles.DarkStyleConfig),
	}
	if width > 0 {
		opts = append(opts, glamour.WithWordWrap(width))
	}

	r, err := glamour.NewTermRenderer(opts...)
	if err != nil {
		return nil, err
	}

	rendererCache.Store(width, r)
	return r, nil
}

// trimTrailingWhitespace removes trailing newlines and spaces that glamour
// appends to rendered output. Callers manage their own spacing between blocks.
func trimTrailingWhitespace(s string) string {
	return strings.TrimRight(s, "\n \t")
}
