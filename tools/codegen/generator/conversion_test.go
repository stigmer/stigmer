package main

import (
	"bytes"
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

	if _, ok := ctx.imports["github.com/stigmer/stigmer/sdk/go/gen/types"]; !ok {
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

	if _, ok := ctx.imports["github.com/stigmer/stigmer/sdk/go/gen/types"]; !ok {
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
				`resource.Spec.CreatedAt = timestamppb.New(t)`,
			},
		},
		{
			name:  "struct",
			field: field("Params", "params", "params", TypeSpec{Kind: "struct"}),
			contains: []string{
				`if i.Params != nil`,
				`structpb.NewStruct(i.Params)`,
				`resource.Spec.Params`,
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
				`resource.Spec.Config = i.Config.toProto()`,
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
				`for _, item := range i.Items`,
				`item.toProto()`,
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
				`v.toProto()`,
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
		})
	}
}

// ============================================================================
// B2: TestEmitOneofToProto
// ============================================================================

func TestEmitOneofToProto(t *testing.T) {
	t.Run("generates_wrapper_struct", func(t *testing.T) {
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
		emitOneofToProto(&buf, f, "mcpv1", "McpServerSpec", typeMap)
		got := buf.String()

		mustContain(t, got, `resource.Spec.ServerType = &mcpv1.McpServerSpec_Stdio{`)
		mustContain(t, got, `Stdio: &mcpv1.StdioServerConfig{`)
		mustContain(t, got, `Command: i.Stdio.Command,`)
		mustContain(t, got, `Args: i.Stdio.Args,`)
	})

	t.Run("type_not_found_no_output", func(t *testing.T) {
		f := &FieldSchema{
			Name: "Unknown", JsonName: "unknown", ProtoField: "unknown",
			Type:       TypeSpec{Kind: "message", MessageType: "MissingType"},
			OneofGroup: "some_group",
		}
		var buf bytes.Buffer
		emitOneofToProto(&buf, f, "testv1", "TestSpec", map[string]*TypeSchema{})
		got := buf.String()

		if got != "" {
			t.Errorf("expected no output for missing type, got:\n%s", got)
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

		mustContain(t, got, `func (i *WorkspaceEntryInput) toProto() *sessionv1.WorkspaceEntry`)
		mustContain(t, got, `return &sessionv1.WorkspaceEntry{`)
		mustContain(t, got, `Path: i.Path,`)
		mustContain(t, got, `ReadOnly: i.ReadOnly,`)
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

		mustContain(t, got, `func (i *WorkflowTaskInput) toProto() *taskv1.WorkflowTask`)
		mustContain(t, got, `p := &taskv1.WorkflowTask{}`)
		mustContain(t, got, `p.Name = i.Name`)
		mustContain(t, got, `structpb.NewStruct(i.Params)`)
		mustContain(t, got, `return p`)
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

		mustContain(t, got, `func (i *LineItemInput) toProto() *orderv1.LineItem`)
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

		mustContain(t, got, `func (i *ServerConfigInput) toProto() *svcv1.ServerConfig`)
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
}
