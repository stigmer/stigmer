package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============================================================================
// Test helpers
// ============================================================================

func field(name, jsonName, protoField string, ts TypeSpec) *FieldSchema {
	return &FieldSchema{
		Name:       name,
		JsonName:   jsonName,
		ProtoField: protoField,
		Type:       ts,
	}
}

func requiredField(name, jsonName, protoField string, ts TypeSpec) *FieldSchema {
	f := field(name, jsonName, protoField, ts)
	f.Required = true
	return f
}

func mustContain(t *testing.T, got, pattern string) {
	t.Helper()
	if !strings.Contains(got, pattern) {
		t.Errorf("output missing expected pattern %q\ngot:\n%s", pattern, got)
	}
}

func mustNotContain(t *testing.T, got, pattern string) {
	t.Helper()
	if strings.Contains(got, pattern) {
		t.Errorf("output unexpectedly contains pattern %q\ngot:\n%s", pattern, got)
	}
}

// ============================================================================
// Part A: main.go — structpb Conversion Generation
// ============================================================================

func TestGenFromProtoField(t *testing.T) {
	tests := []struct {
		name     string
		field    *FieldSchema
		ctx      *genContext
		contains []string
	}{
		{
			name:  "string",
			field: field("Title", "title", "title", TypeSpec{Kind: "string"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`if val, ok := fields["title"]; ok {`,
				`c.Title = val.GetStringValue()`,
			},
		},
		{
			name:  "int32",
			field: field("Count", "count", "count", TypeSpec{Kind: "int32"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`if val, ok := fields["count"]; ok {`,
				`c.Count = int32(val.GetNumberValue())`,
			},
		},
		{
			name:  "int64",
			field: field("BigNum", "bigNum", "big_num", TypeSpec{Kind: "int64"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`if val, ok := fields["bigNum"]; ok {`,
				`c.BigNum = int64(val.GetNumberValue())`,
			},
		},
		{
			name:  "bool",
			field: field("Enabled", "enabled", "enabled", TypeSpec{Kind: "bool"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`c.Enabled = val.GetBoolValue()`,
			},
		},
		{
			name:  "float",
			field: field("Rate", "rate", "rate", TypeSpec{Kind: "float"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`c.Rate = float32(val.GetNumberValue())`,
			},
		},
		{
			name:  "double",
			field: field("Score", "score", "score", TypeSpec{Kind: "double"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`c.Score = val.GetNumberValue()`,
			},
		},
		{
			name:  "struct",
			field: field("Params", "params", "params", TypeSpec{Kind: "struct"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`c.Params = val.GetStructValue().AsMap()`,
			},
		},
		{
			name: "map_string_string",
			field: field("Labels", "labels", "labels", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "string"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.Labels = make(map[string]string)`,
				`for k, v := range val.GetStructValue().GetFields()`,
				`c.Labels[k] = v.GetStringValue()`,
			},
		},
		{
			name: "map_string_message_local",
			field: field("Entries", "entries", "entries", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.Entries = make(map[string]*WorkflowTask)`,
				`item := &WorkflowTask{}`,
				`item.FromProto(v.GetStructValue())`,
				`c.Entries[k] = item`,
			},
		},
		{
			name: "map_string_message_shared",
			field: field("Entries", "entries", "entries", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "HttpEndpoint"},
			}),
			ctx: newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"}),
			contains: []string{
				`c.Entries = make(map[string]*types.HttpEndpoint)`,
				`item := &types.HttpEndpoint{}`,
			},
		},
		{
			name:  "map_nil_key_value",
			field: field("Data", "data", "data", TypeSpec{Kind: "map"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`// TODO: Map with unknown key/value type`,
				`_ = val`,
			},
		},
		{
			name: "map_non_string_value",
			field: field("Data", "data", "data", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "int32"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`// TODO: Map with key=string value=int32`,
			},
		},
		{
			name:  "message_local",
			field: field("Config", "config", "config", TypeSpec{Kind: "message", MessageType: "WorkflowTask"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`c.Config = &WorkflowTask{}`,
				`c.Config.FromProto(val.GetStructValue())`,
			},
		},
		{
			name:  "message_shared",
			field: field("Endpoint", "endpoint", "endpoint", TypeSpec{Kind: "message", MessageType: "HttpEndpoint"}),
			ctx:   newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"}),
			contains: []string{
				`c.Endpoint = &types.HttpEndpoint{}`,
				`c.Endpoint.FromProto(val.GetStructValue())`,
			},
		},
		{
			name:  "message_well_known_timestamp",
			field: field("CreatedAt", "createdAt", "created_at", TypeSpec{Kind: "message", MessageType: "Timestamp"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`time.Parse(time.RFC3339Nano, strVal)`,
				`timestamppb.New(t)`,
			},
		},
		{
			name: "array_string",
			field: field("Tags", "tags", "tags", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "string"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.Tags = make([]string, 0)`,
				`for _, v := range val.GetListValue().GetValues()`,
				`c.Tags = append(c.Tags, v.GetStringValue())`,
			},
		},
		{
			name: "array_int32",
			field: field("Counts", "counts", "counts", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "int32"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.Counts = make([]int32, 0)`,
				`int32(v.GetNumberValue())`,
			},
		},
		{
			name: "array_int64",
			field: field("BigNums", "bigNums", "big_nums", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "int64"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.BigNums = make([]int64, 0)`,
				`int64(v.GetNumberValue())`,
			},
		},
		{
			name: "array_message_local",
			field: field("Tasks", "tasks", "tasks", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`c.Tasks = make([]*WorkflowTask, 0)`,
				`item := &WorkflowTask{}`,
				`item.FromProto(v.GetStructValue())`,
				`c.Tasks = append(c.Tasks, item)`,
			},
		},
		{
			name: "array_message_shared",
			field: field("Endpoints", "endpoints", "endpoints", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "HttpEndpoint"},
			}),
			ctx: newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"}),
			contains: []string{
				`c.Endpoints = make([]*types.HttpEndpoint, 0)`,
				`item := &types.HttpEndpoint{}`,
			},
		},
		{
			name:  "array_nil_element",
			field: field("Items", "items", "items", TypeSpec{Kind: "array"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`// TODO: Array with unknown element type`,
				`_ = val`,
			},
		},
		{
			name: "array_unknown_element_kind",
			field: field("Items", "items", "items", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "bytes"},
			}),
			ctx: newGenContext("gen"),
			contains: []string{
				`// TODO: Array of bytes type`,
			},
		},
		{
			name:  "unknown_kind",
			field: field("Blob", "blob", "blob", TypeSpec{Kind: "weird"}),
			ctx:   newGenContext("gen"),
			contains: []string{
				`// TODO: Implement FromProto for weird field Blob`,
				`_ = val`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			tc.ctx.genFromProtoField(&buf, tc.field)
			got := buf.String()

			mustContain(t, got, `if val, ok := fields["`+tc.field.JsonName+`"]; ok {`)

			for _, pattern := range tc.contains {
				mustContain(t, got, pattern)
			}
		})
	}
}

func TestGenFromProtoField_SharedTypeImport(t *testing.T) {
	ctx := newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"})
	f := field("Endpoint", "endpoint", "endpoint", TypeSpec{Kind: "message", MessageType: "HttpEndpoint"})

	var buf bytes.Buffer
	ctx.genFromProtoField(&buf, f)

	if _, ok := ctx.imports["github.com/stigmer/stigmer/sdk/go/v3/gen/types"]; !ok {
		t.Error("shared type message should add types import")
	}
}

func TestGenFromProtoField_SharedMapMessageImport(t *testing.T) {
	ctx := newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"})
	f := field("Entries", "entries", "entries", TypeSpec{
		Kind:      "map",
		KeyType:   &TypeSpec{Kind: "string"},
		ValueType: &TypeSpec{Kind: "message", MessageType: "HttpEndpoint"},
	})

	var buf bytes.Buffer
	ctx.genFromProtoField(&buf, f)

	if _, ok := ctx.imports["github.com/stigmer/stigmer/sdk/go/v3/gen/types"]; !ok {
		t.Error("shared type in map value should add types import")
	}
}

func TestGenFromProtoField_SharedTypeSamePackage(t *testing.T) {
	ctx := newGenContextWithSharedTypes("types", []string{"HttpEndpoint"})
	f := field("Endpoint", "endpoint", "endpoint", TypeSpec{Kind: "message", MessageType: "HttpEndpoint"})

	var buf bytes.Buffer
	ctx.genFromProtoField(&buf, f)
	got := buf.String()

	mustContain(t, got, `c.Endpoint = &HttpEndpoint{}`)
	mustNotContain(t, got, `types.HttpEndpoint`)
}

// ============================================================================
// A2: TestGenToProtoMethod
// ============================================================================

func TestGenToProtoMethod(t *testing.T) {
	tests := []struct {
		name       string
		config     *TaskConfigSchema
		contains   []string
		notContain []string
	}{
		{
			name: "required_scalar",
			config: &TaskConfigSchema{
				Name:   "TestConfig",
				Fields: []*FieldSchema{requiredField("Url", "url", "url", TypeSpec{Kind: "string"})},
			},
			contains: []string{
				`func (c *TestConfig) ToProto() (*structpb.Struct, error)`,
				`data["url"] = c.Url`,
				`return structpb.NewStruct(data)`,
			},
			notContain: []string{`isEmpty`},
		},
		{
			name: "optional_scalar",
			config: &TaskConfigSchema{
				Name:   "TestConfig",
				Fields: []*FieldSchema{field("Url", "url", "url", TypeSpec{Kind: "string"})},
			},
			contains: []string{
				`if !isEmpty(c.Url)`,
				`data["url"] = c.Url`,
			},
		},
		{
			name: "required_expression_string",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					{
						Name: "Uri", JsonName: "uri", ProtoField: "uri",
						Type: TypeSpec{Kind: "string"}, Required: true, IsExpression: true,
					},
				},
			},
			contains: []string{
				`data["uri"] = coerceToString(c.Uri)`,
			},
		},
		{
			name: "optional_expression_string",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					{
						Name: "Uri", JsonName: "uri", ProtoField: "uri",
						Type: TypeSpec{Kind: "string"}, IsExpression: true,
					},
				},
			},
			contains: []string{
				`if !isEmpty(c.Uri)`,
				`coerceToString(c.Uri)`,
			},
		},
		{
			name: "required_message",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					requiredField("Endpoint", "endpoint", "endpoint",
						TypeSpec{Kind: "message", MessageType: "HttpEndpoint"}),
				},
			},
			contains: []string{
				`json.Marshal(c.Endpoint)`,
				`json.Unmarshal(jsonBytes, &EndpointMap)`,
				`data["endpoint"] = EndpointMap`,
			},
			notContain: []string{`isEmpty`},
		},
		{
			name: "optional_message",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					field("Endpoint", "endpoint", "endpoint",
						TypeSpec{Kind: "message", MessageType: "HttpEndpoint"}),
				},
			},
			contains: []string{
				`if !isEmpty(c.Endpoint) && c.Endpoint != nil`,
				`json.Marshal(c.Endpoint)`,
				`data["endpoint"] = EndpointMap`,
			},
		},
		{
			name: "required_array_of_message",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					requiredField("Tasks", "tasks", "tasks", TypeSpec{
						Kind:        "array",
						ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
					}),
				},
			},
			contains: []string{
				`if c.Tasks != nil`,
				`json.Marshal(c.Tasks)`,
				`var TasksArray []interface{}`,
				`json.Unmarshal(jsonBytes, &TasksArray)`,
				`data["tasks"] = TasksArray`,
			},
			notContain: []string{`isEmpty`},
		},
		{
			name: "optional_array_of_message",
			config: &TaskConfigSchema{
				Name: "TestConfig",
				Fields: []*FieldSchema{
					field("Tasks", "tasks", "tasks", TypeSpec{
						Kind:        "array",
						ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
					}),
				},
			},
			contains: []string{
				`if !isEmpty(c.Tasks)`,
				`json.Marshal(c.Tasks)`,
				`data["tasks"] = TasksArray`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx := newGenContext("gen")
			var buf bytes.Buffer
			if err := ctx.genToProtoMethod(&buf, tc.config); err != nil {
				t.Fatalf("genToProtoMethod returned error: %v", err)
			}
			got := buf.String()

			for _, pattern := range tc.contains {
				mustContain(t, got, pattern)
			}
			for _, pattern := range tc.notContain {
				mustNotContain(t, got, pattern)
			}
		})
	}
}

func TestGenToProtoMethod_StructpbImport(t *testing.T) {
	config := &TaskConfigSchema{
		Name:   "Cfg",
		Fields: []*FieldSchema{requiredField("X", "x", "x", TypeSpec{Kind: "string"})},
	}
	ctx := newGenContext("gen")
	var buf bytes.Buffer
	if err := ctx.genToProtoMethod(&buf, config); err != nil {
		t.Fatal(err)
	}
	if _, ok := ctx.imports["google.golang.org/protobuf/types/known/structpb"]; !ok {
		t.Error("genToProtoMethod should always add structpb import")
	}
}

func TestGenToProtoMethod_MessageAddsJsonImport(t *testing.T) {
	config := &TaskConfigSchema{
		Name: "Cfg",
		Fields: []*FieldSchema{
			field("E", "e", "e", TypeSpec{Kind: "message", MessageType: "Foo"}),
		},
	}
	ctx := newGenContext("gen")
	var buf bytes.Buffer
	if err := ctx.genToProtoMethod(&buf, config); err != nil {
		t.Fatal(err)
	}
	if _, ok := ctx.imports["encoding/json"]; !ok {
		t.Error("message field should add encoding/json import")
	}
}

// ============================================================================
// A3: TestGenWellKnownTypeFromProto
// ============================================================================

func TestGenWellKnownTypeFromProto(t *testing.T) {
	tests := []struct {
		name        string
		messageType string
		contains    []string
		importKeys  []string
	}{
		{
			name:        "timestamp",
			messageType: "Timestamp",
			contains: []string{
				`time.Parse(time.RFC3339Nano, strVal)`,
				`timestamppb.New(t)`,
				`structVal := val.GetStructValue()`,
				`seconds = int64(s.GetNumberValue())`,
				`nanos = int32(n.GetNumberValue())`,
				`&timestamppb.Timestamp{Seconds: seconds, Nanos: nanos}`,
			},
			importKeys: []string{
				"timestamppb:google.golang.org/protobuf/types/known/timestamppb",
				"time",
			},
		},
		{
			name:        "duration",
			messageType: "Duration",
			contains: []string{
				`structVal := val.GetStructValue()`,
				`seconds = int64(s.GetNumberValue())`,
				`nanos = int32(n.GetNumberValue())`,
				`&durationpb.Duration{Seconds: seconds, Nanos: nanos}`,
			},
			importKeys: []string{
				"durationpb:google.golang.org/protobuf/types/known/durationpb",
			},
		},
		{
			name:        "unknown_well_known",
			messageType: "Any",
			contains: []string{
				`// TODO: Handle well-known type Any`,
				`_ = val`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx := newGenContext("gen")
			f := field("MyField", "myField", "my_field", TypeSpec{Kind: "message", MessageType: tc.messageType})
			var buf bytes.Buffer
			ctx.genWellKnownTypeFromProto(&buf, f)
			got := buf.String()

			for _, pattern := range tc.contains {
				mustContain(t, got, pattern)
			}

			for _, key := range tc.importKeys {
				if _, ok := ctx.imports[key]; !ok {
					t.Errorf("expected import %q to be added", key)
				}
			}
		})
	}
}

// ============================================================================
// A4: TestGenerateMessageFieldConversion
// ============================================================================

func TestGenerateMessageFieldConversion(t *testing.T) {
	t.Run("HttpEndpoint_applies_coerceToString", func(t *testing.T) {
		ctx := newGenContext("gen")
		f := field("Endpoint", "endpoint", "endpoint", TypeSpec{Kind: "message", MessageType: "HttpEndpoint"})
		var buf bytes.Buffer
		ctx.generateMessageFieldConversion(&buf, f, "EndpointMap")
		got := buf.String()

		mustContain(t, got, `EndpointMap["uri"]`)
		mustContain(t, got, `coerceToString(uri)`)
	})

	t.Run("other_message_no_output", func(t *testing.T) {
		ctx := newGenContext("gen")
		f := field("Config", "config", "config", TypeSpec{Kind: "message", MessageType: "SomeOtherType"})
		var buf bytes.Buffer
		ctx.generateMessageFieldConversion(&buf, f, "ConfigMap")
		got := buf.String()

		if got != "" {
			t.Errorf("expected no output for non-HttpEndpoint, got:\n%s", got)
		}
	})
}

// ============================================================================
// A5: TestGenTypeFromProtoMethod
// ============================================================================

func TestGenTypeFromProtoMethod(t *testing.T) {
	typeSchema := &TypeSchema{
		Name: "HttpEndpoint",
		Fields: []*FieldSchema{
			field("Uri", "uri", "uri", TypeSpec{Kind: "string"}),
			field("Method", "method", "method", TypeSpec{Kind: "string"}),
		},
	}

	ctx := newGenContext("types")
	var buf bytes.Buffer
	if err := ctx.genTypeFromProtoMethod(&buf, typeSchema); err != nil {
		t.Fatalf("genTypeFromProtoMethod returned error: %v", err)
	}
	got := buf.String()

	mustContain(t, got, `func (c *HttpEndpoint) FromProto(s *structpb.Struct) error`)
	mustContain(t, got, `fields := s.GetFields()`)
	mustContain(t, got, `fields["uri"]`)
	mustContain(t, got, `fields["method"]`)
	mustContain(t, got, `return nil`)

	if _, ok := ctx.imports["google.golang.org/protobuf/types/known/structpb"]; !ok {
		t.Error("genTypeFromProtoMethod should add structpb import")
	}
}

// ============================================================================
// A6: Roundtrip Symmetry Tests
// ============================================================================

func TestRoundtripSymmetry(t *testing.T) {
	symmetryCases := []struct {
		name  string
		field *FieldSchema
	}{
		{
			name:  "string",
			field: requiredField("Title", "title", "title", TypeSpec{Kind: "string"}),
		},
		{
			name:  "bool",
			field: requiredField("Enabled", "enabled", "enabled", TypeSpec{Kind: "bool"}),
		},
		{
			name:  "int32",
			field: requiredField("Count", "count", "count", TypeSpec{Kind: "int32"}),
		},
		{
			name: "message",
			field: requiredField("Config", "config", "config",
				TypeSpec{Kind: "message", MessageType: "WorkflowTask"}),
		},
		{
			name: "array_of_message",
			field: requiredField("Tasks", "tasks", "tasks", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
			}),
		},
		{
			name: "map_string_string",
			field: requiredField("Labels", "labels", "labels", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "string"},
			}),
		},
	}

	for _, tc := range symmetryCases {
		t.Run(tc.name, func(t *testing.T) {
			config := &TaskConfigSchema{
				Name:   "TestConfig",
				Fields: []*FieldSchema{tc.field},
			}

			toCtx := newGenContext("gen")
			var toBuf bytes.Buffer
			if err := toCtx.genToProtoMethod(&toBuf, config); err != nil {
				t.Fatalf("genToProtoMethod error: %v", err)
			}
			toOutput := toBuf.String()

			fromCtx := newGenContext("gen")
			var fromBuf bytes.Buffer
			if err := fromCtx.genFromProtoMethod(&fromBuf, config); err != nil {
				t.Fatalf("genFromProtoMethod error: %v", err)
			}
			fromOutput := fromBuf.String()

			toKey := `"` + tc.field.JsonName + `"`
			mustContain(t, toOutput, toKey)
			mustContain(t, fromOutput, toKey)

			mustContain(t, toOutput, "c."+tc.field.Name)
			mustContain(t, fromOutput, "c."+tc.field.Name)
		})
	}
}

// ============================================================================
// Part B: sdk_client.go — Typed Proto Conversion Generation
// ============================================================================

// ============================================================================
// B1: TestEmitToProtoField
// ============================================================================

func TestEmitToProtoField(t *testing.T) {
	tests := []struct {
		name     string
		field    *FieldSchema
		typeMap  map[string]*TypeSchema
		contains []string
	}{
		{
			name:  "timestamp",
			field: field("CreatedAt", "createdAt", "created_at", TypeSpec{Kind: "timestamp"}),
			contains: []string{
				`time.Parse(time.RFC3339, i.CreatedAt)`,
				`return nil, fieldErr("CreatedAt", err)`,
				`resource.Spec.CreatedAt = timestamppb.New(t)`,
			},
		},
		{
			name:  "struct",
			field: field("Params", "params", "params", TypeSpec{Kind: "struct"}),
			contains: []string{
				`if i.Params != nil`,
				`structFromMap(i.Params)`,
				`return nil, fieldErr("Params", err)`,
				`resource.Spec.Params = v`,
			},
		},
		{
			name:  "value",
			field: field("Default", "default", "default", TypeSpec{Kind: "value"}),
			contains: []string{
				`if i.Default != nil`,
				`valueFromAny(i.Default)`,
				`return nil, fieldErr("Default", err)`,
				`resource.Spec.Default = v`,
			},
		},
		{
			name:  "scalar_string",
			field: field("Title", "title", "title", TypeSpec{Kind: "string"}),
			contains: []string{
				`resource.Spec.Title = i.Title`,
			},
		},
		{
			name:  "scalar_bool",
			field: field("Enabled", "enabled", "enabled", TypeSpec{Kind: "bool"}),
			contains: []string{
				`resource.Spec.Enabled = i.Enabled`,
			},
		},
		{
			name:  "scalar_int32",
			field: field("Count", "count", "count", TypeSpec{Kind: "int32"}),
			contains: []string{
				`resource.Spec.Count = i.Count`,
			},
		},
		{
			name:  "scalar_int64",
			field: field("BigNum", "bigNum", "big_num", TypeSpec{Kind: "int64"}),
			contains: []string{
				`resource.Spec.BigNum = i.BigNum`,
			},
		},
		{
			name:  "scalar_bytes",
			field: field("Data", "data", "data", TypeSpec{Kind: "bytes"}),
			contains: []string{
				`resource.Spec.Data = i.Data`,
			},
		},
		{
			name:  "message_environment_spec",
			field: field("EnvSpec", "envSpec", "env_spec", TypeSpec{Kind: "message", MessageType: "EnvironmentSpec"}),
			contains: []string{
				`if i.EnvSpec != nil`,
				`resource.Spec.EnvSpec = i.EnvSpec.toProto()`,
			},
		},
		{
			name:  "message_api_resource_reference",
			field: field("AgentRef", "agentRef", "agent_ref", TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}),
			contains: []string{
				`i.AgentRef.Org != ""`,
				`i.AgentRef.Slug != ""`,
				`resource.Spec.AgentRef = i.AgentRef.toProto()`,
			},
		},
		{
			name: "message_with_oneof",
			field: &FieldSchema{
				Name: "Stdio", JsonName: "stdio", ProtoField: "stdio",
				Type:       TypeSpec{Kind: "message", MessageType: "StdioServerConfig"},
				OneofGroup: "server_type",
			},
			typeMap: map[string]*TypeSchema{
				"StdioServerConfig": {
					Name: "StdioServerConfig",
					Fields: []*FieldSchema{
						field("Command", "command", "command", TypeSpec{Kind: "string"}),
					},
				},
			},
			contains: []string{
				`if i.Stdio != nil`,
				`resource.Spec.ServerType`,
			},
		},
		{
			name:  "message_generic",
			field: field("Config", "config", "config", TypeSpec{Kind: "message", MessageType: "SomeConfig"}),
			contains: []string{
				`if i.Config != nil`,
				`v, err := i.Config.toProto()`,
				`return nil, fieldErr("Config", err)`,
				`resource.Spec.Config = v`,
			},
		},
		{
			name: "array_string",
			field: field("Tags", "tags", "tags", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "string"},
			}),
			contains: []string{
				`resource.Spec.Tags = i.Tags`,
			},
		},
		{
			name: "array_api_resource_reference",
			field: field("Refs", "refs", "refs", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "ApiResourceReference"},
			}),
			contains: []string{
				`for _, r := range i.Refs`,
				`r.toProto()`,
			},
		},
		{
			name: "array_generic_message",
			field: field("Items", "items", "items", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
			}),
			contains: []string{
				`for idx, item := range i.Items`,
				`v, err := item.toProto()`,
				`return nil, indexErr("Items", idx, err)`,
				`resource.Spec.Items = append(resource.Spec.Items, v)`,
			},
		},
		{
			name: "array_struct",
			field: field("Entries", "entries", "entries", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "struct"},
			}),
			contains: []string{
				`for idx, item := range i.Entries`,
				`v, err := structFromMap(item)`,
				`return nil, indexErr("Entries", idx, err)`,
				`resource.Spec.Entries = append(resource.Spec.Entries, v)`,
			},
		},
		{
			name: "map_execution_value",
			field: field("Values", "values", "values", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "ExecutionValue"},
			}),
			contains: []string{
				`if len(i.Values) > 0`,
				`executioncontextv1.ExecutionValue`,
				`Value: v.Value`,
				`IsSecret: v.IsSecret`,
			},
		},
		{
			name: "map_environment_value",
			field: field("Vars", "vars", "vars", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "EnvironmentValue"},
			}),
			contains: []string{
				`if len(i.Vars) > 0`,
				`environmentv1.EnvironmentValue`,
				`Description: v.Description`,
			},
		},
		{
			name: "map_generic_message",
			field: field("Configs", "configs", "configs", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "SomeConfig"},
			}),
			contains: []string{
				`if len(i.Configs) > 0`,
				`pv, err := val.toProto()`,
				`return nil, keyErr("Configs", k, err)`,
				`resource.Spec.Configs[k] = pv`,
			},
		},
		{
			name: "map_scalar_values",
			field: field("Labels", "labels", "labels", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "string"},
			}),
			contains: []string{
				`resource.Spec.Labels = i.Labels`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			typeMap := tc.typeMap
			if typeMap == nil {
				typeMap = map[string]*TypeSchema{}
			}
			emitToProtoField(&buf, tc.field, "testv1", typeMap, "TestSpec")
			got := buf.String()

			for _, pattern := range tc.contains {
				mustContain(t, got, pattern)
			}

			// The silent-drop class (stigmer/stigmer#342): no emitted
			// conversion may discard its error — neither the blank-assign
			// shape nor the append-only-on-success shape.
			mustNotContain(t, got, `, _ = structpb`)
			mustNotContain(t, got, `err == nil`)
		})
	}
}

// ============================================================================
// B2: TestEmitOneofMemberToProto
// ============================================================================

func TestEmitOneofMemberToProto(t *testing.T) {
	t.Run("generates_guarded_wrapper_assignment", func(t *testing.T) {
		f := &FieldSchema{
			Name: "Stdio", JsonName: "stdio", ProtoField: "stdio",
			Type:       TypeSpec{Kind: "message", MessageType: "StdioServerConfig"},
			OneofGroup: "server_type",
		}
		typeMap := map[string]*TypeSchema{
			"StdioServerConfig": {
				Name: "StdioServerConfig",
				Fields: []*FieldSchema{
					field("Command", "command", "command", TypeSpec{Kind: "string"}),
					field("Args", "args", "args", TypeSpec{Kind: "string"}),
				},
			},
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "mcpv1", "McpServerSpec", "resource.Spec", typeMap)
		got := buf.String()

		mustContain(t, got, `if i.Stdio != nil {`)
		mustContain(t, got, `m := &mcpv1.StdioServerConfig{}`)
		mustContain(t, got, `m.Command = i.Stdio.Command`)
		mustContain(t, got, `m.Args = i.Stdio.Args`)
		mustContain(t, got, `resource.Spec.ServerType = &mcpv1.McpServerSpec_Stdio{Stdio: m}`)
	})

	t.Run("synthetic_oneof_member_field_gets_presence_pointer", func(t *testing.T) {
		// GitRepoSource.depth is proto3 optional (synthetic oneof "_depth"):
		// the proto field is *int32. The zero value must stay absent so the
		// server default (shallow clone) applies; non-zero is set by pointer.
		f := &FieldSchema{
			Name: "GitRepo", JsonName: "gitRepo", ProtoField: "git_repo",
			Type:       TypeSpec{Kind: "message", MessageType: "GitRepoSource"},
			OneofGroup: "source",
		}
		typeMap := map[string]*TypeSchema{
			"GitRepoSource": {
				Name: "GitRepoSource",
				Fields: []*FieldSchema{
					field("Url", "url", "url", TypeSpec{Kind: "string"}),
					{Name: "Depth", JsonName: "depth", ProtoField: "depth",
						Type: TypeSpec{Kind: "int32"}, OneofGroup: "_depth"},
				},
			},
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "sessionv1", "WorkspaceSource", "p", typeMap)
		got := buf.String()

		mustContain(t, got, `m.Url = i.GitRepo.Url`)
		mustContain(t, got, `if i.GitRepo.Depth != 0 {`)
		mustContain(t, got, `v := i.GitRepo.Depth`)
		mustContain(t, got, `m.Depth = &v`)
		mustContain(t, got, `p.Source = &sessionv1.WorkspaceSource_GitRepo{GitRepo: m}`)
	})

	t.Run("type_not_found_no_output", func(t *testing.T) {
		f := &FieldSchema{
			Name: "Unknown", JsonName: "unknown", ProtoField: "unknown",
			Type:       TypeSpec{Kind: "message", MessageType: "MissingType"},
			OneofGroup: "some_group",
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "testv1", "TestSpec", "resource.Spec", map[string]*TypeSchema{})
		got := buf.String()

		if got != "" {
			t.Errorf("expected no output for missing type, got:\n%s", got)
		}
	})

	t.Run("api_resource_reference_member_converts_with_kind_stamp", func(t *testing.T) {
		// Schedule's AgentTarget.agent_ref: a ResourceRef member inside a
		// oneof. A direct copy does not compile (ResourceRef vs
		// *apiresource.ApiResourceReference) — the member must convert via
		// toProto() with the schema's referenceKind stamped, exactly like
		// the spec-level and nested-message reference handling.
		f := &FieldSchema{
			Name: "Agent", JsonName: "agent", ProtoField: "agent",
			Type:       TypeSpec{Kind: "message", MessageType: "AgentTarget"},
			OneofGroup: "target",
		}
		typeMap := map[string]*TypeSchema{
			"AgentTarget": {
				Name: "AgentTarget",
				Fields: []*FieldSchema{
					{Name: "AgentRef", JsonName: "agentRef", ProtoField: "agent_ref",
						Type:          TypeSpec{Kind: "message", MessageType: "ApiResourceReference"},
						ReferenceKind: 40},
					field("Message", "message", "message", TypeSpec{Kind: "string"}),
				},
			},
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "schedulev1", "ScheduleSpec", "resource.Spec", typeMap)
		got := buf.String()

		mustContain(t, got, `if i.Agent.AgentRef.Org != "" || i.Agent.AgentRef.Slug != "" {`)
		mustContain(t, got, `ref := i.Agent.AgentRef.toProto()`)
		mustContain(t, got, `ref.Kind = apiresourcekind.ApiResourceKind_agent`)
		mustContain(t, got, `m.AgentRef = ref`)
		mustContain(t, got, `m.Message = i.Agent.Message`)
		mustNotContain(t, got, `m.AgentRef = i.Agent.AgentRef`)
	})

	t.Run("repeated_reference_member_converts_with_kind_stamp", func(t *testing.T) {
		// Schedule's AgentTarget.environment_refs (project DD-017): a
		// repeated ApiResourceReference member converts element-wise with
		// the schema's kind stamped, exactly like its spec-level twin — a
		// direct copy assigns []ResourceRef to
		// []*apiresource.ApiResourceReference and does not compile.
		f := &FieldSchema{
			Name: "Agent", JsonName: "agent", ProtoField: "agent",
			Type:       TypeSpec{Kind: "message", MessageType: "AgentTarget"},
			OneofGroup: "target",
		}
		typeMap := map[string]*TypeSchema{
			"AgentTarget": {
				Name: "AgentTarget",
				Fields: []*FieldSchema{
					{Name: "EnvironmentRefs", JsonName: "environmentRefs", ProtoField: "environment_refs",
						Type: TypeSpec{Kind: "array",
							ElementType: &TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}},
						ReferenceKind: 53},
				},
			},
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "schedulev1", "ScheduleSpec", "resource.Spec", typeMap)
		got := buf.String()

		mustContain(t, got, `for _, r := range i.Agent.EnvironmentRefs {`)
		mustContain(t, got, `ref := r.toProto()`)
		mustContain(t, got, `ref.Kind = apiresourcekind.ApiResourceKind_environment`)
		mustContain(t, got, `m.EnvironmentRefs = append(m.EnvironmentRefs, ref)`)
		mustNotContain(t, got, `m.EnvironmentRefs = i.Agent.EnvironmentRefs`)
	})

	t.Run("message_member_converts_through_guarded_toProto", func(t *testing.T) {
		// Schedule's AgentTarget.run_config (project DD-017): a
		// message-typed member converts through its Input type's own
		// toProto behind a nil guard — a direct copy assigns
		// *ScheduleRunConfigInput to the proto type and does not compile.
		f := &FieldSchema{
			Name: "Agent", JsonName: "agent", ProtoField: "agent",
			Type:       TypeSpec{Kind: "message", MessageType: "AgentTarget"},
			OneofGroup: "target",
		}
		typeMap := map[string]*TypeSchema{
			"AgentTarget": {
				Name: "AgentTarget",
				Fields: []*FieldSchema{
					{Name: "RunConfig", JsonName: "runConfig", ProtoField: "run_config",
						Type: TypeSpec{Kind: "message", MessageType: "ScheduleRunConfig"}},
				},
			},
			"ScheduleRunConfig": {
				Name: "ScheduleRunConfig",
				Fields: []*FieldSchema{
					field("ModelName", "modelName", "model_name", TypeSpec{Kind: "string"}),
				},
			},
		}
		var buf bytes.Buffer
		emitOneofMemberToProto(&buf, f, "schedulev1", "ScheduleSpec", "resource.Spec", typeMap)
		got := buf.String()

		mustContain(t, got, `if i.Agent.RunConfig != nil {`)
		mustContain(t, got, `v, err := i.Agent.RunConfig.toProto()`)
		mustContain(t, got, `return nil, fieldErr("Agent.RunConfig", err)`)
		mustContain(t, got, `m.RunConfig = v`)
		mustNotContain(t, got, "m.RunConfig = i.Agent.RunConfig\n")
	})
}

// ============================================================================
// B2b: TestEmitFromProtoOneof
// ============================================================================

func TestEmitFromProtoOneof(t *testing.T) {
	// DELIBERATE PIN REWRITE (project DD-017): oneof members now convert
	// through the member type's own generated converter
	// (<memberType>InputFromProto) instead of an inline struct literal.
	// The literal was a drifted second copy of the conversion — it
	// handled only scalar and single-reference members and failed to
	// compile the first time a member carried a repeated reference or a
	// nested message (Schedule's AgentTarget.environment_refs /
	// .run_config). One converter, two callers; the converter itself is
	// pinned by TestEmitNestedFromProtoFunc-style coverage.
	t.Run("member_delegates_to_its_generated_converter", func(t *testing.T) {
		fields := []*FieldSchema{
			{
				Name: "Agent", JsonName: "agent", ProtoField: "agent",
				Type:       TypeSpec{Kind: "message", MessageType: "AgentTarget"},
				OneofGroup: "target",
			},
		}
		typeMap := map[string]*TypeSchema{
			"AgentTarget": {
				Name: "AgentTarget",
				Fields: []*FieldSchema{
					{Name: "AgentRef", JsonName: "agentRef", ProtoField: "agent_ref",
						Type:          TypeSpec{Kind: "message", MessageType: "ApiResourceReference"},
						ReferenceKind: 40},
					field("Message", "message", "message", TypeSpec{Kind: "string"}),
				},
			},
		}
		var buf bytes.Buffer
		emitFromProtoOneof(&buf, fields, "schedulev1", typeMap)
		got := buf.String()

		mustContain(t, got, `if ov := s.GetAgent(); ov != nil {`)
		mustContain(t, got, `input.Agent = agentTargetInputFromProto(ov)`)
		// The drifted inline literal must not come back.
		mustNotContain(t, got, `input.Agent = &AgentTargetInput{`)
		mustNotContain(t, got, `AgentRef: ov.GetAgentRef(),`)
	})

	t.Run("unknown_member_type_is_skipped", func(t *testing.T) {
		// A member whose type is absent from the type map (e.g. a
		// synthetic-oneof scalar) emits nothing rather than a call to a
		// converter that does not exist.
		fields := []*FieldSchema{
			{
				Name: "Stdio", JsonName: "stdio", ProtoField: "stdio",
				Type:       TypeSpec{Kind: "message", MessageType: "StdioServerConfig"},
				OneofGroup: "server_type",
			},
		}
		var buf bytes.Buffer
		emitFromProtoOneof(&buf, fields, "mcpv1", map[string]*TypeSchema{})
		if buf.Len() != 0 {
			t.Fatalf("expected no output for a member type missing from the type map, got:\n%s", buf.String())
		}
	})
}

// ============================================================================
// B3: TestEmitNestedToProto
// ============================================================================

func TestEmitNestedToProto(t *testing.T) {
	t.Run("simple_message_single_return", func(t *testing.T) {
		f := field("Config", "config", "config",
			TypeSpec{Kind: "message", MessageType: "WorkspaceEntry"})
		typeMap := map[string]*TypeSchema{
			"WorkspaceEntry": {
				Name: "WorkspaceEntry",
				Fields: []*FieldSchema{
					field("Path", "path", "path", TypeSpec{Kind: "string"}),
					field("ReadOnly", "readOnly", "read_only", TypeSpec{Kind: "bool"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "sessionv1", typeMap, emitted, "SessionSpec", make(map[string]bool))
		got := buf.String()

		// Even a type where nothing can fail returns (proto, error): every
		// schema-derived Input's toProto is uniformly fallible so a schema
		// change never flips a signature (stigmer/stigmer#342).
		mustContain(t, got, `func (i *WorkspaceEntryInput) toProto() (*sessionv1.WorkspaceEntry, error)`)
		mustContain(t, got, `return &sessionv1.WorkspaceEntry{`)
		mustContain(t, got, `Path: i.Path,`)
		mustContain(t, got, `ReadOnly: i.ReadOnly,`)
		mustContain(t, got, `}, nil`)
	})

	t.Run("message_with_struct_field", func(t *testing.T) {
		f := field("Task", "task", "task",
			TypeSpec{Kind: "message", MessageType: "WorkflowTask"})
		typeMap := map[string]*TypeSchema{
			"WorkflowTask": {
				Name: "WorkflowTask",
				Fields: []*FieldSchema{
					field("Name", "name", "name", TypeSpec{Kind: "string"}),
					field("Params", "params", "params", TypeSpec{Kind: "struct"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "taskv1", typeMap, emitted, "TaskSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *WorkflowTaskInput) toProto() (*taskv1.WorkflowTask, error)`)
		mustContain(t, got, `p := &taskv1.WorkflowTask{}`)
		mustContain(t, got, `p.Name = i.Name`)
		mustContain(t, got, `v, err := structFromMap(i.Params)`)
		mustContain(t, got, `return nil, fieldErr("Params", err)`)
		mustContain(t, got, `return p, nil`)
		// The silent-drop shape that shipped empty task configs
		// (stigmer/stigmer#342) must never be emitted again.
		mustNotContain(t, got, `, _ = structpb`)
		mustNotContain(t, got, `err == nil`)
	})

	t.Run("api_resource_reference_in_simple_type", func(t *testing.T) {
		f := field("Item", "item", "item",
			TypeSpec{Kind: "message", MessageType: "RefHolder"})
		typeMap := map[string]*TypeSchema{
			"RefHolder": {
				Name: "RefHolder",
				Fields: []*FieldSchema{
					field("Name", "name", "name", TypeSpec{Kind: "string"}),
					field("Ref", "ref", "ref",
						TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", typeMap, emitted, "TestSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `p.Ref = i.Ref.toProto()`)
	})

	t.Run("api_resource_reference_in_struct_type", func(t *testing.T) {
		f := field("Item", "item", "item",
			TypeSpec{Kind: "message", MessageType: "RefHolderWithStruct"})
		typeMap := map[string]*TypeSchema{
			"RefHolderWithStruct": {
				Name: "RefHolderWithStruct",
				Fields: []*FieldSchema{
					field("Name", "name", "name", TypeSpec{Kind: "string"}),
					field("Params", "params", "params", TypeSpec{Kind: "struct"}),
					field("Ref", "ref", "ref",
						TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", typeMap, emitted, "TestSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `p.Ref = i.Ref.toProto()`)
	})

	t.Run("skip_special_type", func(t *testing.T) {
		for _, specialType := range []string{"EnvironmentSpec", "EnvironmentValue", "ExecutionValue", "ApiResourceReference"} {
			t.Run(specialType, func(t *testing.T) {
				f := field("Spec", "spec", "spec",
					TypeSpec{Kind: "message", MessageType: specialType})
				var buf bytes.Buffer
				emitNestedToProto(&buf, f, "testv1", map[string]*TypeSchema{}, make(map[string]bool), "TestSpec", make(map[string]bool))
				if buf.String() != "" {
					t.Errorf("expected no output for special type %s, got:\n%s", specialType, buf.String())
				}
			})
		}
	})

	t.Run("skip_oneof_field", func(t *testing.T) {
		// A field that is itself a oneof member is handled inline by
		// emitOneofMemberToProto at its container; no standalone toProto.
		f := &FieldSchema{
			Name: "Stdio", JsonName: "stdio", ProtoField: "stdio",
			Type:       TypeSpec{Kind: "message", MessageType: "StdioConfig"},
			OneofGroup: "server_type",
		}
		typeMap := map[string]*TypeSchema{
			"StdioConfig": {Name: "StdioConfig", Fields: []*FieldSchema{
				field("Cmd", "cmd", "cmd", TypeSpec{Kind: "string"}),
			}},
		}
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", typeMap, make(map[string]bool), "TestSpec", make(map[string]bool))
		if buf.String() != "" {
			t.Errorf("expected no output for oneof field, got:\n%s", buf.String())
		}
	})

	t.Run("nested_message_with_oneof_members_assigns_wrapper", func(t *testing.T) {
		// The WorkspaceSource shape: a nested message whose only fields are
		// oneof members. The emitted toProto must assign the oneof wrapper —
		// silently dropping the member produced an empty proto and broke the
		// one-call session bootstrap for Go SDK users (stigmer/stigmer#249).
		f := field("Source", "source", "source",
			TypeSpec{Kind: "message", MessageType: "WorkspaceSource"})
		typeMap := map[string]*TypeSchema{
			"WorkspaceSource": {
				Name: "WorkspaceSource",
				Fields: []*FieldSchema{
					{Name: "GitRepo", JsonName: "gitRepo", ProtoField: "git_repo",
						Type:       TypeSpec{Kind: "message", MessageType: "GitRepoSource"},
						OneofGroup: "source"},
					{Name: "LocalPath", JsonName: "localPath", ProtoField: "local_path",
						Type:       TypeSpec{Kind: "message", MessageType: "LocalPathSource"},
						OneofGroup: "source"},
				},
			},
			"GitRepoSource": {
				Name: "GitRepoSource",
				Fields: []*FieldSchema{
					field("Url", "url", "url", TypeSpec{Kind: "string"}),
				},
			},
			"LocalPathSource": {
				Name: "LocalPathSource",
				Fields: []*FieldSchema{
					field("Path", "path", "path", TypeSpec{Kind: "string"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "sessionv1", typeMap, emitted, "SessionSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *WorkspaceSourceInput) toProto() (*sessionv1.WorkspaceSource, error)`)
		mustContain(t, got, `if i.GitRepo != nil {`)
		mustContain(t, got, `p.Source = &sessionv1.WorkspaceSource_GitRepo{GitRepo: m}`)
		mustContain(t, got, `if i.LocalPath != nil {`)
		mustContain(t, got, `p.Source = &sessionv1.WorkspaceSource_LocalPath{LocalPath: m}`)
	})

	t.Run("skip_already_emitted", func(t *testing.T) {
		f := field("Config", "config", "config",
			TypeSpec{Kind: "message", MessageType: "SomeType"})
		typeMap := map[string]*TypeSchema{
			"SomeType": {Name: "SomeType", Fields: []*FieldSchema{
				field("X", "x", "x", TypeSpec{Kind: "string"}),
			}},
		}
		emitted := map[string]bool{"SomeType_toProto": true}
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", typeMap, emitted, "TestSpec", make(map[string]bool))
		if buf.String() != "" {
			t.Errorf("expected no output for already-emitted type, got:\n%s", buf.String())
		}
	})

	t.Run("skip_unknown_type", func(t *testing.T) {
		f := field("Config", "config", "config",
			TypeSpec{Kind: "message", MessageType: "NonExistent"})
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", map[string]*TypeSchema{}, make(map[string]bool), "TestSpec", make(map[string]bool))
		if buf.String() != "" {
			t.Errorf("expected no output for unknown type, got:\n%s", buf.String())
		}
	})

	t.Run("array_of_message", func(t *testing.T) {
		f := field("Items", "items", "items", TypeSpec{
			Kind:        "array",
			ElementType: &TypeSpec{Kind: "message", MessageType: "LineItem"},
		})
		typeMap := map[string]*TypeSchema{
			"LineItem": {
				Name: "LineItem",
				Fields: []*FieldSchema{
					field("Sku", "sku", "sku", TypeSpec{Kind: "string"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "orderv1", typeMap, emitted, "OrderSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *LineItemInput) toProto() (*orderv1.LineItem, error)`)
		if !emitted["LineItem_toProto"] {
			t.Error("expected LineItem_toProto to be marked as emitted")
		}
	})

	t.Run("map_of_message", func(t *testing.T) {
		f := field("Configs", "configs", "configs", TypeSpec{
			Kind:      "map",
			KeyType:   &TypeSpec{Kind: "string"},
			ValueType: &TypeSpec{Kind: "message", MessageType: "ServerConfig"},
		})
		typeMap := map[string]*TypeSchema{
			"ServerConfig": {
				Name: "ServerConfig",
				Fields: []*FieldSchema{
					field("Port", "port", "port", TypeSpec{Kind: "int32"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "svcv1", typeMap, emitted, "SvcSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *ServerConfigInput) toProto() (*svcv1.ServerConfig, error)`)
	})

	t.Run("scalar_field_no_output", func(t *testing.T) {
		f := field("Name", "name", "name", TypeSpec{Kind: "string"})
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", map[string]*TypeSchema{}, make(map[string]bool), "TestSpec", make(map[string]bool))
		if buf.String() != "" {
			t.Errorf("expected no output for scalar field, got:\n%s", buf.String())
		}
	})

	t.Run("recursive_nested_types", func(t *testing.T) {
		f := field("Outer", "outer", "outer",
			TypeSpec{Kind: "message", MessageType: "OuterType"})
		typeMap := map[string]*TypeSchema{
			"OuterType": {
				Name: "OuterType",
				Fields: []*FieldSchema{
					field("Name", "name", "name", TypeSpec{Kind: "string"}),
					field("Inner", "inner", "inner",
						TypeSpec{Kind: "message", MessageType: "InnerType"}),
				},
			},
			"InnerType": {
				Name: "InnerType",
				Fields: []*FieldSchema{
					field("Value", "value", "value", TypeSpec{Kind: "string"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "testv1", typeMap, emitted, "TestSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *OuterTypeInput) toProto()`)
		mustContain(t, got, `func (i *InnerTypeInput) toProto()`)
		if !emitted["OuterType_toProto"] {
			t.Error("OuterType_toProto not marked as emitted")
		}
		if !emitted["InnerType_toProto"] {
			t.Error("InnerType_toProto not marked as emitted")
		}
	})

	t.Run("message_and_array_fields_in_struct_type", func(t *testing.T) {
		f := field("Task", "task", "task",
			TypeSpec{Kind: "message", MessageType: "WorkflowTask"})
		typeMap := map[string]*TypeSchema{
			"WorkflowTask": {
				Name: "WorkflowTask",
				Fields: []*FieldSchema{
					field("Name", "name", "name", TypeSpec{Kind: "string"}),
					field("Kind", "kind", "kind", TypeSpec{Kind: "string"}),
					field("TaskConfig", "taskConfig", "task_config", TypeSpec{Kind: "struct"}),
					field("Export", "export", "export",
						TypeSpec{Kind: "message", MessageType: "Export"}),
					field("Flow", "flow", "flow",
						TypeSpec{Kind: "message", MessageType: "FlowControl"}),
					field("Compensate", "compensate", "compensate", TypeSpec{
						Kind:        "array",
						ElementType: &TypeSpec{Kind: "message", MessageType: "WorkflowTask"},
					}),
				},
			},
			"Export": {
				Name: "Export",
				Fields: []*FieldSchema{
					field("As", "as", "as", TypeSpec{Kind: "string"}),
				},
			},
			"FlowControl": {
				Name: "FlowControl",
				Fields: []*FieldSchema{
					field("Then", "then", "then", TypeSpec{Kind: "string"}),
				},
			},
		}
		emitted := make(map[string]bool)
		var buf bytes.Buffer
		emitNestedToProto(&buf, f, "workflowv1", typeMap, emitted, "WorkflowSpec", make(map[string]bool))
		got := buf.String()

		mustContain(t, got, `func (i *WorkflowTaskInput) toProto() (*workflowv1.WorkflowTask, error)`)
		mustContain(t, got, `p := &workflowv1.WorkflowTask{}`)
		mustContain(t, got, `p.Name = i.Name`)
		mustContain(t, got, `p.Kind = i.Kind`)
		mustContain(t, got, `v, err := structFromMap(i.TaskConfig)`)
		mustContain(t, got, `return nil, fieldErr("TaskConfig", err)`)
		mustContain(t, got, `if i.Export != nil`)
		mustContain(t, got, `v, err := i.Export.toProto()`)
		mustContain(t, got, `return nil, fieldErr("Export", err)`)
		mustContain(t, got, `if i.Flow != nil`)
		mustContain(t, got, `for idx, item := range i.Compensate`)
		mustContain(t, got, `return nil, indexErr("Compensate", idx, err)`)
		mustContain(t, got, `p.Compensate = append(p.Compensate, v)`)
		mustNotContain(t, got, `, _ = structpb`)
		mustNotContain(t, got, `err == nil`)

		mustContain(t, got, `func (i *ExportInput) toProto() (*workflowv1.Export, error)`)
		mustContain(t, got, `func (i *FlowControlInput) toProto() (*workflowv1.FlowControl, error)`)
	})
}

// ============================================================================
// Part C: sdk_client_java.go — Java SDK Conversion Generation
// ============================================================================

// ============================================================================
// C1: TestGenerateJavaProtoConvert
// ============================================================================

func TestGenerateJavaProtoConvert_RefusesInsteadOfCoercing(t *testing.T) {
	dir := t.TempDir()
	if err := generateJavaProtoConvert(dir); err != nil {
		t.Fatalf("generateJavaProtoConvert: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "ProtoConvert.java"))
	if err != nil {
		t.Fatalf("read emitted ProtoConvert.java: %v", err)
	}
	got := string(data)

	// The silent String.valueOf fallthrough put a POJO's toString on the
	// wire ("com.example.Outcome@1a2b3c4d") with no failure until a human
	// inspected the degraded resource (stigmer/stigmer#448, the Java twin
	// of #342's silent-drop class). The coercion expression must never be
	// emitted again (the class comment may still NAME String.valueOf when
	// telling the story, so the pin targets the code shape).
	mustNotContain(t, got, `setStringValue(String.valueOf(obj))`)

	// Unsupported values surface as the SDK's structured error — a value
	// the SDK refuses client-side looks exactly like a value the server
	// would have refused.
	mustContain(t, got, `throw invalidValue`)
	mustContain(t, got, `ErrorCode.INVALID_ARGUMENT`)

	// Arrays are not Iterable — without an explicit arm, String[] takes
	// the fallthrough. They convert faithfully to ListValue.
	mustContain(t, got, `obj.getClass().isArray()`)
	mustContain(t, got, `java.lang.reflect.Array.getLength(obj)`)

	// Struct keys must be String; a non-String key smuggled through type
	// erasure gets the structured error, not a bare ClassCastException.
	mustContain(t, got, `Struct keys must be String`)
}

// ============================================================================
// C2: TestEmitJavaToProtoField — struct/value call sites thread the field path
// ============================================================================

func TestEmitJavaToProtoField_StructAndValueThreadFieldPath(t *testing.T) {
	// The builder field name rides into the conversion as the error-path
	// root, so a refusal names exactly the field the caller set (e.g.
	// `taskConfig["outcome"]: unsupported value of type ...`).
	t.Run("spec_struct_field", func(t *testing.T) {
		var buf bytes.Buffer
		emitJavaToProtoField(&buf,
			field("TaskConfig", "taskConfig", "task_config", TypeSpec{Kind: "struct"}),
			map[string]*TypeSchema{}, "workflowv1", "        ")
		got := buf.String()

		mustContain(t, got, `spec.setTaskConfig(ProtoConvert.mapToStruct(this.taskConfig, "taskConfig"));`)
	})

	t.Run("spec_value_field_reserved_word", func(t *testing.T) {
		// javaCamel suffixes Java reserved words ("default" -> "default_");
		// the path must match the builder method the caller actually used.
		var buf bytes.Buffer
		emitJavaToProtoField(&buf,
			field("Default", "default", "default", TypeSpec{Kind: "value"}),
			map[string]*TypeSchema{}, "datastorev1", "        ")
		got := buf.String()

		mustContain(t, got, `spec.setDefault(ProtoConvert.objectToValue(this.default_, "default_"));`)
	})

	t.Run("nested_struct_field", func(t *testing.T) {
		var buf bytes.Buffer
		emitJavaNestedToProtoField(&buf,
			field("TaskConfig", "taskConfig", "task_config", TypeSpec{Kind: "struct"}),
			map[string]*TypeSchema{}, "workflowv1", "            ")
		got := buf.String()

		mustContain(t, got, `builder.setTaskConfig(ProtoConvert.mapToStruct(this.taskConfig, "taskConfig"));`)
	})

	t.Run("nested_value_field", func(t *testing.T) {
		var buf bytes.Buffer
		emitJavaNestedToProtoField(&buf,
			field("Equals", "equals", "equals", TypeSpec{Kind: "value"}),
			map[string]*TypeSchema{}, "datastorev1", "            ")
		got := buf.String()

		mustContain(t, got, `builder.setEquals(ProtoConvert.objectToValue(this.equals_, "equals_"));`)
	})
}
