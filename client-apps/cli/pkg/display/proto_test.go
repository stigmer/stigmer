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
