package harness

import (
	"testing"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// AssertStructuredOutputPopulated verifies that structuredOutput is non-nil on the execution status.
// This is the fundamental contract: schema + completed execution → structuredOutput populated.
func AssertStructuredOutputPopulated(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	require.NotNil(t, exec, "execution should not be nil")
	so := exec.GetStatus().GetStructuredOutput()
	assert.NotNil(t, so, "structuredOutput should be populated on a completed execution with schema. "+
		"Phase: %s, Error: %q", exec.GetStatus().GetPhase(), exec.GetStatus().GetError())
}

// AssertStructuredOutputNil verifies that structuredOutput is nil.
func AssertStructuredOutputNil(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	require.NotNil(t, exec, "execution should not be nil")
	so := exec.GetStatus().GetStructuredOutput()
	assert.Nil(t, so, "structuredOutput should be nil for this scenario. Got %d fields", structFieldCount(so))
}

// AssertStructuredOutputHasKeys verifies that structuredOutput contains the specified top-level keys.
func AssertStructuredOutputHasKeys(t *testing.T, exec *agentexecv1.AgentExecution, keys ...string) {
	t.Helper()
	so := exec.GetStatus().GetStructuredOutput()
	require.NotNil(t, so, "structuredOutput should be non-nil to check keys")
	for _, key := range keys {
		_, exists := so.GetFields()[key]
		assert.True(t, exists, "structuredOutput missing key: %q. Available keys: %v", key, StructKeys(so))
	}
}

// AssertExecutionHasSchema verifies the execution's spec.executionConfig.structuredOutputSchema is non-nil.
// Targets: A1 (proto Struct fields silently dropped via `as any` on create)
func AssertExecutionHasSchema(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	schema := exec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()
	assert.NotNil(t, schema, "[A1] structuredOutputSchema should be persisted on the execution spec. "+
		"If nil, the schema was likely dropped during proto serialization (as any cast).")
	if schema != nil {
		t.Logf("schema persisted with %d fields: %v", len(schema.GetFields()), StructKeys(schema))
	}
}

// AssertNestedArrayStructure verifies that a structuredOutput field is an array of objects with expected keys.
// Targets: D1 (nested objects not validated), D2 (items schema ignored)
func AssertNestedArrayStructure(t *testing.T, exec *agentexecv1.AgentExecution, arrayKey string, expectedItemKeys []string) {
	t.Helper()
	so := exec.GetStatus().GetStructuredOutput()
	require.NotNil(t, so, "structuredOutput should be non-nil")

	val, exists := so.GetFields()[arrayKey]
	require.True(t, exists, "structuredOutput missing array key: %q", arrayKey)

	listVal := val.GetListValue()
	if listVal == nil {
		t.Errorf("[D2] expected %q to be an array, got %T — array schema type not enforced", arrayKey, val.GetKind())
		return
	}

	if len(listVal.GetValues()) == 0 {
		t.Logf("warning: %q array is empty — cannot validate item structure", arrayKey)
		return
	}

	firstItem := listVal.GetValues()[0].GetStructValue()
	if firstItem == nil {
		t.Errorf("[D1] expected array items to be objects, got %T — nested object schema not enforced",
			listVal.GetValues()[0].GetKind())
		return
	}

	for _, itemKey := range expectedItemKeys {
		_, itemKeyExists := firstItem.GetFields()[itemKey]
		assert.True(t, itemKeyExists, "[D1] nested item missing key: %q. Available: %v", itemKey, StructKeys(firstItem))
	}
}

// FormatStructuredOutputSummary returns a human-readable summary for test logs.
func FormatStructuredOutputSummary(exec *agentexecv1.AgentExecution) string {
	status := exec.GetStatus()
	so := status.GetStructuredOutput()
	schema := exec.GetSpec().GetExecutionConfig().GetStructuredOutputSchema()

	soInfo := "nil"
	if so != nil {
		soInfo = formatStructKeys(so)
	}
	schemaInfo := "nil"
	if schema != nil {
		schemaInfo = formatStructKeys(schema)
	}

	return "phase=" + status.GetPhase().String() +
		", structuredOutput=" + soInfo +
		", schema=" + schemaInfo +
		", error=" + status.GetError()
}

// StructKeys returns the top-level keys of a structpb.Struct.
func StructKeys(s *structpb.Struct) []string {
	if s == nil {
		return nil
	}
	keys := make([]string, 0, len(s.GetFields()))
	for k := range s.GetFields() {
		keys = append(keys, k)
	}
	return keys
}

func structFieldCount(s *structpb.Struct) int {
	if s == nil {
		return 0
	}
	return len(s.GetFields())
}

func formatStructKeys(s *structpb.Struct) string {
	keys := StructKeys(s)
	if len(keys) == 0 {
		return "{}"
	}
	result := "{"
	for i, k := range keys {
		if i > 0 {
			result += ", "
		}
		result += k
	}
	return result + "}"
}

// --- Schema Builders ---

// SummaryScoreSchema returns a simple schema: {summary: string, score: number}
func SummaryScoreSchema(t *testing.T) *structpb.Struct {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{
				"type":        "string",
				"description": "A brief summary",
			},
			"score": map[string]any{
				"type":        "number",
				"description": "A numeric score from 1 to 10",
			},
		},
		"required": []any{"summary", "score"},
	})
	require.NoError(t, err)
	return schema
}

// NestedArraySchema returns: {items: [{name: string, count: number}]}
func NestedArraySchema(t *testing.T) *structpb.Struct {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"items": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name":  map[string]any{"type": "string"},
						"count": map[string]any{"type": "number"},
					},
					"required": []any{"name", "count"},
				},
			},
		},
		"required": []any{"items"},
	})
	require.NoError(t, err)
	return schema
}

// NullableFieldSchema returns: {name: string, notes: string|null}
func NullableFieldSchema(t *testing.T) *structpb.Struct {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":  map[string]any{"type": "string"},
			"notes": map[string]any{"type": []any{"string", "null"}},
		},
		"required": []any{"name"},
	})
	require.NoError(t, err)
	return schema
}

// CohortsArraySchema returns: {cohorts: [{name, size, action_needed}]}
func CohortsArraySchema(t *testing.T) *structpb.Struct {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"cohorts": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name":          map[string]any{"type": "string"},
						"size":          map[string]any{"type": "number"},
						"action_needed": map[string]any{"type": "boolean"},
					},
					"required": []any{"name", "size", "action_needed"},
				},
			},
		},
		"required": []any{"cohorts"},
	})
	require.NoError(t, err)
	return schema
}
