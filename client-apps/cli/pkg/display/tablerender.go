// Package display provides utilities for rendering formatted output in the CLI.
// This file contains a shared table renderer for list/collection views.
package display

import (
	"fmt"
	"io"
	"strings"
)

const (
	defaultColumnGap   = 3
	defaultMinColWidth = 10
)

// DisplayEmptyResults prints a standardized empty-state message for list commands.
// If query is non-empty, the message indicates no matches for that query.
func DisplayEmptyResults(resourceName string, query string) {
	fmt.Println()
	if query != "" {
		fmt.Printf("No %s found matching '%s'\n", resourceName, query)
	} else {
		fmt.Printf("No %s found\n", resourceName)
	}
	fmt.Println()
}

// Table renders columnar data with dynamic widths and optional terminal-width
// adaptation. Create with NewTable, populate with AddRow, then call Render.
type Table struct {
	headers   []string
	rows      [][]string
	headerFmt func(...interface{}) string
	adaptive  bool
	termWidth int // 0 = auto-detect via GetTerminalWidth()
}

// TableOption configures table rendering behavior.
type TableOption func(*Table)

// WithHeaderColor sets a Sprint-style formatter applied to each header cell.
// Typically used with fatih/color's SprintFunc().
func WithHeaderColor(fn func(...interface{}) string) TableOption {
	return func(t *Table) { t.headerFmt = fn }
}

// WithAdaptive enables terminal-width adaptation. When the table's natural
// width exceeds the terminal, columns are shrunk starting with the widest.
// Terminal width is auto-detected at render time.
func WithAdaptive() TableOption {
	return func(t *Table) { t.adaptive = true }
}

// WithTerminalWidth enables adaptive mode with an explicit terminal width.
// Useful for testing or rendering to a fixed-width target.
func WithTerminalWidth(width int) TableOption {
	return func(t *Table) {
		t.adaptive = true
		t.termWidth = width
	}
}

// NewTable creates a Table with the given column headers and options.
func NewTable(headers []string, opts ...TableOption) *Table {
	t := &Table{headers: headers}
	for _, opt := range opts {
		opt(t)
	}
	return t
}

// AddRow appends a data row. The number of cells should match the number
// of headers; missing cells are treated as empty, extra cells are ignored.
func (t *Table) AddRow(cells ...string) {
	t.rows = append(t.rows, cells)
}

// IsEmpty reports whether the table has no data rows.
func (t *Table) IsEmpty() bool {
	return len(t.rows) == 0
}

// Render writes the formatted table to w: a header row, a dash separator,
// and all data rows with dynamically computed column widths. Render is a
// no-op when the table has no rows.
func (t *Table) Render(w io.Writer) {
	if len(t.rows) == 0 {
		return
	}

	widths := t.computeWidths()
	if t.adaptive {
		t.applyAdaptiveWidths(widths)
	}

	gap := strings.Repeat(" ", defaultColumnGap)
	t.renderHeader(w, widths, gap)
	t.renderSeparator(w, widths, gap)
	t.renderRows(w, widths, gap)
}

// computeWidths returns the natural (max-content) width for each column,
// measured with ANSI-aware grapheme width.
func (t *Table) computeWidths() []int {
	widths := make([]int, len(t.headers))
	for i, h := range t.headers {
		widths[i] = MeasureColorizedString(h)
	}
	for _, row := range t.rows {
		for i, cell := range row {
			if i < len(widths) {
				if cw := MeasureColorizedString(cell); cw > widths[i] {
					widths[i] = cw
				}
			}
		}
	}
	return widths
}

// applyAdaptiveWidths shrinks column widths so the table fits within the
// terminal. It repeatedly reduces the widest column until the table fits
// or all columns reach the minimum width.
func (t *Table) applyAdaptiveWidths(widths []int) {
	tw := t.termWidth
	if tw <= 0 {
		tw = GetTerminalWidth()
	}

	excess := t.totalWidth(widths) - tw
	for excess > 0 {
		widestIdx := -1
		widestVal := 0
		for i, w := range widths {
			if w > widestVal {
				widestVal = w
				widestIdx = i
			}
		}
		if widestIdx < 0 || widths[widestIdx] <= defaultMinColWidth {
			break
		}
		shrink := min(excess, widths[widestIdx]-defaultMinColWidth)
		widths[widestIdx] -= shrink
		excess -= shrink
	}
}

// totalWidth returns the rendered width including inter-column gaps.
func (t *Table) totalWidth(widths []int) int {
	total := 0
	for _, w := range widths {
		total += w
	}
	if len(widths) > 1 {
		total += (len(widths) - 1) * defaultColumnGap
	}
	return total
}

func (t *Table) renderHeader(w io.Writer, widths []int, gap string) {
	parts := make([]string, len(t.headers))
	for i, h := range t.headers {
		cell := h
		if t.headerFmt != nil {
			cell = t.headerFmt(h)
		}
		parts[i] = PadRight(cell, widths[i])
	}
	fmt.Fprintln(w, strings.Join(parts, gap))
}

func (t *Table) renderSeparator(w io.Writer, widths []int, gap string) {
	parts := make([]string, len(widths))
	for i, width := range widths {
		parts[i] = strings.Repeat("-", width)
	}
	fmt.Fprintln(w, strings.Join(parts, gap))
}

func (t *Table) renderRows(w io.Writer, widths []int, gap string) {
	numCols := len(widths)
	for _, row := range t.rows {
		parts := make([]string, numCols)
		for i := range parts {
			var cell string
			if i < len(row) {
				cell = row[i]
			}
			cellWidth := MeasureColorizedString(cell)
			if cellWidth > widths[i] {
				if widths[i] <= 3 {
					cell = "..."[:widths[i]]
				} else {
					cell = TrimColorizedString(cell, widths[i]-3) + "..."
				}
			}
			parts[i] = PadRight(cell, widths[i])
		}
		fmt.Fprintln(w, strings.Join(parts, gap))
	}
}
