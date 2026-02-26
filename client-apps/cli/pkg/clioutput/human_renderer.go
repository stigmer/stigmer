package clioutput

import (
	"fmt"
	"io"
	"strings"

	"github.com/fatih/color"
)

// HumanRenderer formats a CommandResult as colored, human-readable text.
//
// Semantic vocabulary:
//
//	✓ Message   (green bold)  — success
//	⚠ Message   (yellow bold) — warning
//	✗ Message   (red bold)    — error
//	Title:      (bold)        — section heading
//	  Key  Val  (dim key)     — key-value pair, aligned per section
//	  - Item    (normal)      — bullet item
//	  hint      (dim)         — suggestion text
type HumanRenderer struct {
	Out io.Writer
}

func (h *HumanRenderer) Render(result *CommandResult) {
	h.renderStatus(result.Status, result.Message)

	for _, sec := range result.Sections {
		h.renderSection(sec)
	}

	if len(result.Hints) > 0 {
		fmt.Fprintln(h.Out)
		h.renderHints(result.Hints)
	}
}

func (h *HumanRenderer) renderStatus(status ResultStatus, message string) {
	var icon string
	var colorAttr []color.Attribute

	switch status {
	case StatusSuccess:
		icon = "✓"
		colorAttr = []color.Attribute{color.FgGreen, color.Bold}
	case StatusWarning:
		icon = "⚠"
		colorAttr = []color.Attribute{color.FgYellow, color.Bold}
	case StatusError:
		icon = "✗"
		colorAttr = []color.Attribute{color.FgRed, color.Bold}
	}

	c := color.New(colorAttr...)
	c.Fprintf(h.Out, "%s %s\n", icon, message)
}

func (h *HumanRenderer) renderSection(sec *Section) {
	fmt.Fprintln(h.Out)

	if sec.Title != "" {
		bold := color.New(color.Bold)
		bold.Fprintf(h.Out, "%s:\n", sec.Title)
	}

	if len(sec.Fields) > 0 {
		h.renderFields(sec.Fields)
	}

	if len(sec.Items) > 0 {
		h.renderItems(sec.Items)
	}
}

func (h *HumanRenderer) renderFields(fields []KeyValue) {
	maxKeyWidth := 0
	for _, kv := range fields {
		if len(kv.Key) > maxKeyWidth {
			maxKeyWidth = len(kv.Key)
		}
	}

	dim := color.New(color.Faint)
	for _, kv := range fields {
		padding := strings.Repeat(" ", maxKeyWidth-len(kv.Key)+4)
		dim.Fprintf(h.Out, "  %s", kv.Key)
		fmt.Fprintf(h.Out, "%s%s\n", padding, kv.Value)
	}
}

func (h *HumanRenderer) renderItems(items []string) {
	for _, item := range items {
		fmt.Fprintf(h.Out, "  - %s\n", item)
	}
}

func (h *HumanRenderer) renderHints(hints []string) {
	dim := color.New(color.Faint)
	for _, hint := range hints {
		dim.Fprintf(h.Out, "  %s\n", hint)
	}
}
