package clioutput

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func renderJSON(result *CommandResult) (stdout, stderr string) {
	var outBuf, errBuf bytes.Buffer
	r := &JSONRenderer{DataOut: &outBuf, StatusOut: &errBuf}
	r.Render(result)
	return outBuf.String(), errBuf.String()
}

func TestJSONRenderer_ValidJSON(t *testing.T) {
	stdout, _ := renderJSON(Success("Done"))

	var parsed map[string]any
	err := json.Unmarshal([]byte(stdout), &parsed)
	require.NoError(t, err, "output must be valid JSON")
}

func TestJSONRenderer_StatusAsString(t *testing.T) {
	tests := []struct {
		name   string
		result *CommandResult
		want   string
	}{
		{"success", Success("ok"), "success"},
		{"warning", Warning("warn"), "warning"},
		{"error", Error("fail"), "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stdout, _ := renderJSON(tt.result)

			var parsed map[string]any
			require.NoError(t, json.Unmarshal([]byte(stdout), &parsed))
			assert.Equal(t, tt.want, parsed["status"])
		})
	}
}

func TestJSONRenderer_Message(t *testing.T) {
	stdout, _ := renderJSON(Success("Agent created: %s", "my-agent"))

	var parsed map[string]any
	require.NoError(t, json.Unmarshal([]byte(stdout), &parsed))
	assert.Equal(t, "Agent created: my-agent", parsed["message"])
}

func TestJSONRenderer_Sections(t *testing.T) {
	r := Success("Done")
	r.AddSection("Details").
		Field("ID", "abc").
		Field("Name", "agent")
	r.AddSection("Items").
		Item("first").
		Item("second")

	stdout, _ := renderJSON(r)

	var parsed jsonResult
	require.NoError(t, json.Unmarshal([]byte(stdout), &parsed))

	require.Len(t, parsed.Sections, 2)

	assert.Equal(t, "Details", parsed.Sections[0].Title)
	require.Len(t, parsed.Sections[0].Fields, 2)
	assert.Equal(t, "ID", parsed.Sections[0].Fields[0].Key)
	assert.Equal(t, "abc", parsed.Sections[0].Fields[0].Value)

	assert.Equal(t, "Items", parsed.Sections[1].Title)
	require.Len(t, parsed.Sections[1].Items, 2)
	assert.Equal(t, "first", parsed.Sections[1].Items[0])
}

func TestJSONRenderer_Hints(t *testing.T) {
	r := Success("Done").Hint("try this").Hint("and that")

	stdout, _ := renderJSON(r)

	var parsed jsonResult
	require.NoError(t, json.Unmarshal([]byte(stdout), &parsed))

	require.Len(t, parsed.Hints, 2)
	assert.Equal(t, "try this", parsed.Hints[0])
	assert.Equal(t, "and that", parsed.Hints[1])
}

func TestJSONRenderer_OmitsEmptySections(t *testing.T) {
	stdout, _ := renderJSON(Success("Done"))

	var parsed map[string]any
	require.NoError(t, json.Unmarshal([]byte(stdout), &parsed))

	_, hasSections := parsed["sections"]
	assert.False(t, hasSections, "empty sections should be omitted")

	_, hasHints := parsed["hints"]
	assert.False(t, hasHints, "empty hints should be omitted")
}

func TestJSONRenderer_WritesToDataOut(t *testing.T) {
	stdout, stderr := renderJSON(Success("Done"))

	assert.NotEmpty(t, stdout, "JSON data should go to DataOut")
	assert.Empty(t, stderr, "no status messages for successful render")
}
