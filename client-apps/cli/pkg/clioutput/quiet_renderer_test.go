package clioutput

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
)

func renderQuiet(result *CommandResult) string {
	var buf bytes.Buffer
	r := &QuietRenderer{Out: &buf}
	r.Render(result)
	return buf.String()
}

func TestQuietRenderer_StatusLineOnly(t *testing.T) {
	r := Success("Agent created")
	r.AddSection("Details").Field("ID", "abc")
	r.Hint("try this")

	out := renderQuiet(r)

	assert.Contains(t, out, "✓ Agent created\n")
	assert.NotContains(t, out, "Details")
	assert.NotContains(t, out, "abc")
	assert.NotContains(t, out, "try this")
}

func TestQuietRenderer_WarningStatus(t *testing.T) {
	out := renderQuiet(Warning("Something is off"))
	assert.Contains(t, out, "⚠ Something is off\n")
}

func TestQuietRenderer_ErrorStatus(t *testing.T) {
	out := renderQuiet(Error("Failed hard"))
	assert.Contains(t, out, "✗ Failed hard\n")
}

func TestQuietRenderer_NoExtraOutput(t *testing.T) {
	r := Success("Done")
	r.AddSection("Metadata").
		Field("ID", "123").
		Field("Name", "test")
	r.AddSection("Items").
		Item("a").
		Item("b")
	r.Hint("first hint").
		Hint("second hint")

	out := renderQuiet(r)

	// Exactly one line: the status line.
	assert.Equal(t, "✓ Done\n", out)
}
