package display

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTable_IsEmpty(t *testing.T) {
	tbl := NewTable([]string{"A", "B"})
	assert.True(t, tbl.IsEmpty())

	tbl.AddRow("1", "2")
	assert.False(t, tbl.IsEmpty())
}

func TestTable_Render_Empty(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"A", "B"})
	tbl.Render(&buf)
	assert.Empty(t, buf.String(), "empty table should produce no output")
}

func TestTable_Render_SingleRow(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"NAME", "AGE"})
	tbl.AddRow("Alice", "30")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 3, "header + separator + 1 data row")

	assert.Contains(t, lines[0], "NAME")
	assert.Contains(t, lines[0], "AGE")

	// Separator should be only dashes and spaces
	for _, r := range lines[1] {
		assert.True(t, r == '-' || r == ' ', "separator should only contain dashes and spaces, got %q", r)
	}

	assert.Contains(t, lines[2], "Alice")
	assert.Contains(t, lines[2], "30")
}

func TestTable_Render_DynamicColumnWidths(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"A", "B"})
	tbl.AddRow("short", "tiny")
	tbl.AddRow("much longer content here", "x")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 4)

	// All lines should have the same visible width (padded to max)
	expectedWidth := len(lines[0])
	for i, line := range lines {
		assert.Equal(t, expectedWidth, len(line), "line %d should match header width", i)
	}
}

func TestTable_Render_ColumnGap(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"A", "B"})
	tbl.AddRow("x", "y")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	// Between the single-char column "A" and "B", there should be exactly
	// defaultColumnGap spaces.
	assert.Contains(t, lines[0], "A"+strings.Repeat(" ", defaultColumnGap)+"B")
}

func TestTable_WithHeaderColor(t *testing.T) {
	var buf bytes.Buffer
	bracket := func(a ...interface{}) string {
		return "[" + fmt.Sprint(a...) + "]"
	}
	tbl := NewTable([]string{"NAME", "AGE"}, WithHeaderColor(bracket))
	tbl.AddRow("Alice", "30")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Contains(t, lines[0], "[NAME]")
	assert.Contains(t, lines[0], "[AGE]")
}

func TestTable_Adaptive_FitsTerminal(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"A", "B"}, WithTerminalWidth(200))
	tbl.AddRow("short", "text")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 3)
	assert.Contains(t, lines[2], "short")
	assert.Contains(t, lines[2], "text")
	// No truncation markers
	assert.NotContains(t, lines[2], "...")
}

func TestTable_Adaptive_ShrinksWidestColumn(t *testing.T) {
	var buf bytes.Buffer
	long := strings.Repeat("x", 60)
	tbl := NewTable([]string{"WIDE", "NARROW"}, WithTerminalWidth(40))
	tbl.AddRow(long, "ok")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	// The wide column should be truncated
	assert.Contains(t, lines[2], "...")
	// The narrow column should remain intact
	assert.Contains(t, lines[2], "ok")
}

func TestTable_Adaptive_BothColumnsWide(t *testing.T) {
	var buf bytes.Buffer
	col1 := strings.Repeat("a", 40)
	col2 := strings.Repeat("b", 40)
	tbl := NewTable([]string{"C1", "C2"}, WithTerminalWidth(50))
	tbl.AddRow(col1, col2)
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	// Both should be truncated since both are wide
	dataLine := lines[2]
	assert.Contains(t, dataLine, "...")
}

func TestTable_ANSICells_WidthMeasurement(t *testing.T) {
	var buf bytes.Buffer
	green := "\x1b[32mgreen\x1b[0m" // visible width = 5 ("green")
	tbl := NewTable([]string{"STATUS", "NAME"})
	tbl.AddRow(green, "test")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 3)
	// The ANSI-colored cell should be present in output
	assert.Contains(t, lines[2], "\x1b[32m")
	// Column widths should be based on visible width:
	// "STATUS" = 6 chars, "green" = 5 chars -> column width = 6 (header wins)
	// "NAME" = 4 chars, "test" = 4 chars -> column width = 4
	// Separator dashes should reflect these widths
	sepParts := strings.SplitN(lines[1], strings.Repeat(" ", defaultColumnGap), 2)
	assert.Len(t, sepParts, 2)
	assert.Equal(t, 6, len(sepParts[0]), "first column separator width")
	assert.Equal(t, 4, len(sepParts[1]), "second column separator width")
}

func TestTable_PartialRow(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"A", "B", "C"})
	tbl.AddRow("1", "2") // missing third cell
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 3)
	assert.Contains(t, lines[2], "1")
	assert.Contains(t, lines[2], "2")
}

func TestTable_MultipleRows(t *testing.T) {
	var buf bytes.Buffer
	tbl := NewTable([]string{"ID", "NAME"})
	tbl.AddRow("1", "Alice")
	tbl.AddRow("2", "Bob")
	tbl.AddRow("3", "Charlie")
	tbl.Render(&buf)

	lines := splitLines(buf.String())
	assert.Len(t, lines, 5, "header + separator + 3 data rows")
	assert.Contains(t, lines[2], "Alice")
	assert.Contains(t, lines[3], "Bob")
	assert.Contains(t, lines[4], "Charlie")
}

// splitLines splits output into lines, trimming the trailing newline.
func splitLines(s string) []string {
	return strings.Split(strings.TrimRight(s, "\n"), "\n")
}
