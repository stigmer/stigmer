package clioutput

import (
	"bytes"
	"testing"

	"github.com/fatih/color"
	"github.com/stretchr/testify/assert"
)

func init() {
	// Disable color codes for deterministic test output.
	color.NoColor = true
}

func renderHuman(result *CommandResult) string {
	var buf bytes.Buffer
	r := &HumanRenderer{Out: &buf}
	r.Render(result)
	return buf.String()
}

func TestHumanRenderer_SuccessStatus(t *testing.T) {
	out := renderHuman(Success("Agent created"))
	assert.Contains(t, out, "✓ Agent created\n")
}

func TestHumanRenderer_WarningStatus(t *testing.T) {
	out := renderHuman(Warning("Deprecated flag"))
	assert.Contains(t, out, "⚠ Deprecated flag\n")
}

func TestHumanRenderer_ErrorStatus(t *testing.T) {
	out := renderHuman(Error("Connection failed"))
	assert.Contains(t, out, "✗ Connection failed\n")
}

func TestHumanRenderer_SectionTitle(t *testing.T) {
	r := Success("Done")
	r.AddSection("Resource Details").Field("ID", "abc")

	out := renderHuman(r)
	assert.Contains(t, out, "Resource Details:\n")
}

func TestHumanRenderer_FieldAlignment(t *testing.T) {
	r := Success("Done")
	r.AddSection("").
		Field("ID", "abc123").
		Field("Name", "my-agent").
		Field("Organization", "stigmer")

	out := renderHuman(r)

	// "ID" (2 chars) should be padded to match "Organization" (12 chars).
	// Padding = maxKeyWidth - keyLen + 4 = 12 - 2 + 4 = 14 spaces after "ID"
	assert.Contains(t, out, "  ID              abc123\n")
	assert.Contains(t, out, "  Name            my-agent\n")
	assert.Contains(t, out, "  Organization    stigmer\n")
}

func TestHumanRenderer_BulletItems(t *testing.T) {
	r := Success("Done")
	r.AddSection("Next Steps").
		Item("Run the agent").
		Item("Check logs")

	out := renderHuman(r)
	assert.Contains(t, out, "  - Run the agent\n")
	assert.Contains(t, out, "  - Check logs\n")
}

func TestHumanRenderer_Hints(t *testing.T) {
	r := Success("Done").
		Hint("Try: stigmer list agents").
		Hint("Documentation: https://stigmer.dev")

	out := renderHuman(r)
	assert.Contains(t, out, "  Try: stigmer list agents\n")
	assert.Contains(t, out, "  Documentation: https://stigmer.dev\n")
}

func TestHumanRenderer_EmptyResult(t *testing.T) {
	out := renderHuman(Success("Done"))

	// Just the status line, no trailing sections or hints.
	assert.Equal(t, "✓ Done\n", out)
}

func TestHumanRenderer_MultipleSections(t *testing.T) {
	r := Success("Agent details")
	r.AddSection("Metadata").
		Field("ID", "abc").
		Field("Slug", "my-agent")
	r.AddSection("Spec").
		Field("Description", "An agent").
		Item("MCP server: weather-api")

	out := renderHuman(r)

	assert.Contains(t, out, "Metadata:\n")
	assert.Contains(t, out, "Spec:\n")
	assert.Contains(t, out, "  - MCP server: weather-api\n")
}

func TestHumanRenderer_SectionWithoutTitle(t *testing.T) {
	r := Success("Done")
	r.AddSection("").Field("ID", "abc")

	out := renderHuman(r)
	// No ":" line for an empty title.
	assert.NotContains(t, out, ":\n")
	assert.Contains(t, out, "  ID    abc\n")
}

func TestHumanRenderer_FullOutput(t *testing.T) {
	r := Warning("Partial success")
	r.AddSection("Created").
		Field("ID", "abc123").
		Field("Name", "my-agent")
	r.AddSection("Errors").
		Item("skill-a: timeout")
	r.Hint("Retry: stigmer apply")

	out := renderHuman(r)

	// Verify ordering: status, section 1, section 2, hints
	statusIdx := bytes.Index([]byte(out), []byte("⚠ Partial"))
	createdIdx := bytes.Index([]byte(out), []byte("Created:"))
	errorsIdx := bytes.Index([]byte(out), []byte("Errors:"))
	hintIdx := bytes.Index([]byte(out), []byte("Retry:"))

	assert.True(t, statusIdx < createdIdx, "status before first section")
	assert.True(t, createdIdx < errorsIdx, "first section before second")
	assert.True(t, errorsIdx < hintIdx, "sections before hints")
}
