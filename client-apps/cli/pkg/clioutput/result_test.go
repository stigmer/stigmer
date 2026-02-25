package clioutput

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResultStatus_String(t *testing.T) {
	assert.Equal(t, "success", StatusSuccess.String())
	assert.Equal(t, "warning", StatusWarning.String())
	assert.Equal(t, "error", StatusError.String())
	assert.Equal(t, "unknown", ResultStatus(99).String())
}

func TestSuccess(t *testing.T) {
	r := Success("Agent created: %s", "my-agent")

	assert.Equal(t, StatusSuccess, r.Status)
	assert.Equal(t, "Agent created: my-agent", r.Message)
	assert.Empty(t, r.Sections)
	assert.Empty(t, r.Hints)
}

func TestWarning(t *testing.T) {
	r := Warning("Deprecated: %s", "old-flag")

	assert.Equal(t, StatusWarning, r.Status)
	assert.Equal(t, "Deprecated: old-flag", r.Message)
}

func TestError(t *testing.T) {
	r := Error("Connection failed")

	assert.Equal(t, StatusError, r.Status)
	assert.Equal(t, "Connection failed", r.Message)
}

func TestAddSection_Fields(t *testing.T) {
	r := Success("Done")
	sec := r.AddSection("Details")

	sec.Field("ID", "abc123").
		Field("Name", "my-agent").
		Fieldf("Count", "%d items", 5)

	require.Len(t, r.Sections, 1)
	assert.Equal(t, "Details", r.Sections[0].Title)
	require.Len(t, r.Sections[0].Fields, 3)
	assert.Equal(t, KeyValue{Key: "ID", Value: "abc123"}, r.Sections[0].Fields[0])
	assert.Equal(t, KeyValue{Key: "Name", Value: "my-agent"}, r.Sections[0].Fields[1])
	assert.Equal(t, KeyValue{Key: "Count", Value: "5 items"}, r.Sections[0].Fields[2])
}

func TestAddSection_Items(t *testing.T) {
	r := Success("Done")
	sec := r.AddSection("Next Steps")

	sec.Item("Run the agent").
		Itemf("Delete with: stigmer delete agent %s", "foo")

	require.Len(t, r.Sections[0].Items, 2)
	assert.Equal(t, "Run the agent", r.Sections[0].Items[0])
	assert.Equal(t, "Delete with: stigmer delete agent foo", r.Sections[0].Items[1])
}

func TestMultipleSections(t *testing.T) {
	r := Success("Done")
	r.AddSection("Metadata").Field("ID", "1")
	r.AddSection("Spec").Field("Runtime", "go")

	require.Len(t, r.Sections, 2)
	assert.Equal(t, "Metadata", r.Sections[0].Title)
	assert.Equal(t, "Spec", r.Sections[1].Title)
	assert.Equal(t, "1", r.Sections[0].Fields[0].Value)
	assert.Equal(t, "go", r.Sections[1].Fields[0].Value)
}

func TestHints(t *testing.T) {
	r := Success("Done").
		Hint("Try this next").
		Hintf("Run: stigmer get %s", "agent")

	require.Len(t, r.Hints, 2)
	assert.Equal(t, "Try this next", r.Hints[0])
	assert.Equal(t, "Run: stigmer get agent", r.Hints[1])
}

func TestFullBuilderChain(t *testing.T) {
	r := Warning("Partial success")

	r.AddSection("Created").
		Field("ID", "abc").
		Field("Name", "my-agent")

	r.AddSection("Failed").
		Item("skill-a: timeout").
		Item("skill-b: not found")

	r.Hint("Retry with: stigmer apply --force")

	assert.Equal(t, StatusWarning, r.Status)
	require.Len(t, r.Sections, 2)
	require.Len(t, r.Sections[0].Fields, 2)
	require.Len(t, r.Sections[1].Items, 2)
	require.Len(t, r.Hints, 1)
}

func TestEmptySection(t *testing.T) {
	r := Success("Done")
	r.AddSection("Empty")

	require.Len(t, r.Sections, 1)
	assert.Empty(t, r.Sections[0].Fields)
	assert.Empty(t, r.Sections[0].Items)
}

func TestSectionPointerStability(t *testing.T) {
	r := Success("Done")

	sec1 := r.AddSection("First")

	// Force slice growth by adding many sections, then mutate sec1.
	// Because Sections is []*Section, sec1 remains valid even after
	// the backing array is reallocated.
	for i := 0; i < 20; i++ {
		r.AddSection("filler")
	}

	sec1.Field("A", "1")

	assert.Equal(t, "First", r.Sections[0].Title)
	require.Len(t, r.Sections[0].Fields, 1)
	assert.Equal(t, "1", r.Sections[0].Fields[0].Value)
}
