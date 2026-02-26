package display

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

func testProtoMessage(t *testing.T) *structpb.Struct {
	t.Helper()
	msg, err := structpb.NewStruct(map[string]interface{}{
		"name":        "test-agent",
		"description": "A test resource",
		"count":       float64(42),
	})
	require.NoError(t, err)
	return msg
}

func TestRenderProtoJSON(t *testing.T) {
	msg := testProtoMessage(t)
	var buf bytes.Buffer

	err := RenderProtoJSON(&buf, msg)

	require.NoError(t, err)
	output := buf.String()
	assert.Contains(t, output, `"name": "test-agent"`)
	assert.Contains(t, output, `"description": "A test resource"`)
	assert.Contains(t, output, `"count": 42`)
	assert.True(t, output[len(output)-1] == '\n', "should end with newline")
}

func TestRenderProtoYAML(t *testing.T) {
	msg := testProtoMessage(t)
	var buf bytes.Buffer

	err := RenderProtoYAML(&buf, msg)

	require.NoError(t, err)
	output := buf.String()
	assert.Contains(t, output, "name: test-agent")
	assert.Contains(t, output, "description: A test resource")
	assert.Contains(t, output, "count: 42")
}

func TestRenderProtoJSON_NilMessage(t *testing.T) {
	var buf bytes.Buffer

	err := RenderProtoJSON(&buf, nil)

	require.NoError(t, err)
	assert.Equal(t, "{}\n", buf.String())
}

func TestRenderProtoYAML_NilMessage(t *testing.T) {
	var buf bytes.Buffer

	err := RenderProtoYAML(&buf, nil)

	require.NoError(t, err)
	assert.Equal(t, "{}\n", buf.String())
}

func TestDisplayProto_JSON(t *testing.T) {
	msg := testProtoMessage(t)
	tableCalled := false

	var buf bytes.Buffer
	err := RenderProtoJSON(&buf, msg)
	require.NoError(t, err)

	DisplayProto(msg, "json", func() { tableCalled = true })
	assert.False(t, tableCalled, "table func should not be called for json format")
}

func TestDisplayProto_YAML(t *testing.T) {
	msg := testProtoMessage(t)
	tableCalled := false

	DisplayProto(msg, "yaml", func() { tableCalled = true })
	assert.False(t, tableCalled, "table func should not be called for yaml format")
}

func TestDisplayProto_Table(t *testing.T) {
	msg := testProtoMessage(t)
	tableCalled := false

	DisplayProto(msg, "table", func() { tableCalled = true })
	assert.True(t, tableCalled, "table func should be called for table format")
}

func TestDisplayProto_Default(t *testing.T) {
	msg := testProtoMessage(t)
	tableCalled := false

	DisplayProto(msg, "", func() { tableCalled = true })
	assert.True(t, tableCalled, "table func should be called for empty format (default)")
}

func testProtoSlice(t *testing.T) []*structpb.Struct {
	t.Helper()
	a, err := structpb.NewStruct(map[string]interface{}{
		"name": "alpha",
		"id":   float64(1),
	})
	require.NoError(t, err)
	b, err := structpb.NewStruct(map[string]interface{}{
		"name": "beta",
		"id":   float64(2),
	})
	require.NoError(t, err)
	return []*structpb.Struct{a, b}
}

func TestRenderProtoSliceJSON(t *testing.T) {
	items := testProtoSlice(t)
	var buf bytes.Buffer

	err := RenderProtoSliceJSON(&buf, items)

	require.NoError(t, err)
	output := buf.String()
	assert.Contains(t, output, `"name": "alpha"`)
	assert.Contains(t, output, `"name": "beta"`)
	assert.Contains(t, output, `"id": 1`)
	assert.Contains(t, output, `"id": 2`)
	// Must be a valid JSON array
	assert.True(t, output[0] == '[', "should start with [")
	assert.Contains(t, output, "]\n")
}

func TestRenderProtoSliceJSON_Empty(t *testing.T) {
	var buf bytes.Buffer

	err := RenderProtoSliceJSON(&buf, []*structpb.Struct{})

	require.NoError(t, err)
	assert.Equal(t, "[]\n", buf.String())
}

func TestRenderProtoSliceYAML(t *testing.T) {
	items := testProtoSlice(t)
	var buf bytes.Buffer

	err := RenderProtoSliceYAML(&buf, items)

	require.NoError(t, err)
	output := buf.String()
	assert.Contains(t, output, "name: alpha")
	assert.Contains(t, output, "name: beta")
	assert.Contains(t, output, "id: 1")
	assert.Contains(t, output, "id: 2")
	// YAML arrays use "- " prefix for each element
	assert.Contains(t, output, "- id:")
}

func TestRenderProtoSliceYAML_Empty(t *testing.T) {
	var buf bytes.Buffer

	err := RenderProtoSliceYAML(&buf, []*structpb.Struct{})

	require.NoError(t, err)
	assert.Equal(t, "[]\n", buf.String())
}

func TestDisplayProtoSlice_JSON(t *testing.T) {
	items := testProtoSlice(t)
	tableCalled := false

	DisplayProtoSlice(items, "json", func() { tableCalled = true })
	assert.False(t, tableCalled, "table func should not be called for json format")
}

func TestDisplayProtoSlice_YAML(t *testing.T) {
	items := testProtoSlice(t)
	tableCalled := false

	DisplayProtoSlice(items, "yaml", func() { tableCalled = true })
	assert.False(t, tableCalled, "table func should not be called for yaml format")
}

func TestDisplayProtoSlice_Table(t *testing.T) {
	items := testProtoSlice(t)
	tableCalled := false

	DisplayProtoSlice(items, "table", func() { tableCalled = true })
	assert.True(t, tableCalled, "table func should be called for table format")
}

func TestDisplayProtoSlice_Default(t *testing.T) {
	items := testProtoSlice(t)
	tableCalled := false

	DisplayProtoSlice(items, "", func() { tableCalled = true })
	assert.True(t, tableCalled, "table func should be called for empty format (default)")
}
