package main

import (
	"testing"
)

// ============================================================================
// main.go pure functions
// ============================================================================

func TestExtractDomainFromProtoType(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai.stigmer.commons.apiresource.ApiResourceReference", "commons"},
		{"ai.stigmer.agentic.agent.v1.McpServerDefinition", "agentic"},
		{"ai.stigmer.agentic.skill.v1.SkillSpec", "agentic"},
		{"ai.stigmer.iam.apikey.v1.ApiKeySpec", "iam"},
		{"ai.stigmer.tenancy.organization.v1.OrganizationSpec", "tenancy"},
		{"foo.bar", "unknown"},
		{"single", "unknown"},
		{"", "unknown"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := extractDomainFromProtoType(tc.input)
			if got != tc.want {
				t.Errorf("extractDomainFromProtoType(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExtractSubdomainFromProtoFile(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"apis/ai/stigmer/agentic/agent/v1/spec.proto", "agent"},
		{"apis/ai/stigmer/agentic/skill/v1/spec.proto", "skill"},
		{"apis/ai/stigmer/iam/apikey/v1/spec.proto", "apikey"},
		{"apis/ai/stigmer/tenancy/organization/v1/spec.proto", "organization"},
		{"apis/ai/stigmer/commons/apiresource/io.proto", ""},
		{"short/path.proto", ""},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := extractSubdomainFromProtoFile(tc.input)
			if got != tc.want {
				t.Errorf("extractSubdomainFromProtoFile(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestProtoTypeToGoImportPath(t *testing.T) {
	tests := []struct {
		input  string
		prefix string
		want   string
	}{
		{
			"ai.stigmer.agentic.agent.v1.McpServerUsage",
			sdkProtoPrefix,
			"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agent/v1",
		},
		{
			"ai.stigmer.commons.apiresource.ApiResourceReference",
			sdkProtoPrefix,
			"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource",
		},
		{
			"ai.stigmer.agentic.session.v1.Session",
			mcpProtoPrefix,
			"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/session/v1",
		},
		{"foo.bar.Baz", sdkProtoPrefix, ""},
		{"too.short", sdkProtoPrefix, ""},
		{"x", sdkProtoPrefix, ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := protoTypeToGoImportPath(tc.input, tc.prefix)
			if got != tc.want {
				t.Errorf("protoTypeToGoImportPath(%q, %q) = %q, want %q", tc.input, tc.prefix, got, tc.want)
			}
		})
	}
}

func TestProtoTypeToPackageAlias(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai.stigmer.agentic.agent.v1.McpServerUsage", "agentv1"},
		{"ai.stigmer.agentic.skill.v1.SkillSpec", "skillv1"},
		{"ai.stigmer.commons.apiresource.ApiResourceReference", "apiresource"},
		{"ai.stigmer.agentic.workflow.v1.WorkflowSpec", "workflowv1"},
		{"ai.stigmer.iam.v1.IamRole", "iamv1"},
		{"too.short", ""},
		{"x", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := protoTypeToPackageAlias(tc.input)
			if got != tc.want {
				t.Errorf("protoTypeToPackageAlias(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTitleCase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"HTTP_CALL", "HttpCall"},
		{"AGENT_EXECUTION", "AgentExecution"},
		{"SINGLE", "Single"},
		{"", ""},
		{"a_b_c", "ABC"},
		{"FORK_JOIN_ALL", "ForkJoinAll"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := titleCase(tc.input)
			if got != tc.want {
				t.Errorf("titleCase(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestToSnakeCase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"HttpCallConfig", "http_call_config"},
		{"AgentSpec", "agent_spec"},
		{"ID", "i_d"},
		{"URLPath", "u_r_l_path"},
		{"simple", "simple"},
		{"", ""},
		{"A", "a"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := toSnakeCase(tc.input)
			if got != tc.want {
				t.Errorf("toSnakeCase(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestSanitizeDescription(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"simple", "Hello world", "Hello world"},
		{"newlines", "line1\nline2\nline3", "line1 line2 line3"},
		{"carriage returns", "line1\r\nline2", "line1 line2"},
		{"multiple spaces", "too   many    spaces", "too many spaces"},
		{"leading trailing whitespace", "  trimmed  ", "trimmed"},
		{"empty", "", ""},
		{"newlines and spaces", "  foo\n  bar  \n  baz  ", "foo bar baz"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeDescription(tc.input)
			if got != tc.want {
				t.Errorf("sanitizeDescription(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestMatchEnumValue(t *testing.T) {
	enumValues := []string{"http_call", "agent_execution", "fork_join_all", "conditional"}

	tests := []struct {
		configKind string
		want       string
	}{
		{"HTTP_CALL", "http_call"},
		{"AGENT_EXECUTION", "agent_execution"},
		{"FORK_JOIN_ALL", "fork_join_all"},
		{"CONDITIONAL", "conditional"},
		{"NONEXISTENT", ""},
	}

	for _, tc := range tests {
		t.Run(tc.configKind, func(t *testing.T) {
			got := matchEnumValue(tc.configKind, enumValues)
			if got != tc.want {
				t.Errorf("matchEnumValue(%q, ...) = %q, want %q", tc.configKind, got, tc.want)
			}
		})
	}
}

func TestIsWordSubset(t *testing.T) {
	tests := []struct {
		name     string
		subset   []string
		superset []string
		want     bool
	}{
		{"equal", []string{"A", "B"}, []string{"A", "B"}, true},
		{"subset", []string{"A"}, []string{"A", "B"}, true},
		{"not subset", []string{"C"}, []string{"A", "B"}, false},
		{"empty subset", []string{}, []string{"A", "B"}, true},
		{"empty both", []string{}, []string{}, true},
		{"superset empty", []string{"A"}, []string{}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isWordSubset(tc.subset, tc.superset)
			if got != tc.want {
				t.Errorf("isWordSubset(%v, %v) = %v, want %v", tc.subset, tc.superset, got, tc.want)
			}
		})
	}
}

func TestGenContextParamName(t *testing.T) {
	ctx := newGenContext("test")
	tests := []struct {
		input string
		want  string
	}{
		{"Name", "name"},
		{"URL", "uRL"},
		{"httpEndpoint", "httpEndpoint"},
		{"", ""},
		{"A", "a"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := ctx.paramName(tc.input)
			if got != tc.want {
				t.Errorf("paramName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestGenContextGoType(t *testing.T) {
	ctx := newGenContext("gen")

	tests := []struct {
		name     string
		typeSpec TypeSpec
		want     string
	}{
		{"string", TypeSpec{Kind: "string"}, "string"},
		{"int32", TypeSpec{Kind: "int32"}, "int32"},
		{"int64", TypeSpec{Kind: "int64"}, "int64"},
		{"bool", TypeSpec{Kind: "bool"}, "bool"},
		{"float", TypeSpec{Kind: "float"}, "float32"},
		{"double", TypeSpec{Kind: "double"}, "float64"},
		{"bytes", TypeSpec{Kind: "bytes"}, "[]byte"},
		{"struct", TypeSpec{Kind: "struct"}, "map[string]interface{}"},
		{"array of strings", TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "string"}}, "[]string"},
		{"array of int32", TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "int32"}}, "[]int32"},
		{"map string->string", TypeSpec{
			Kind:      "map",
			KeyType:   &TypeSpec{Kind: "string"},
			ValueType: &TypeSpec{Kind: "string"},
		}, "map[string]string"},
		{"map string->int32", TypeSpec{
			Kind:      "map",
			KeyType:   &TypeSpec{Kind: "string"},
			ValueType: &TypeSpec{Kind: "int32"},
		}, "map[string]int32"},
		{"message local", TypeSpec{Kind: "message", MessageType: "FooBar"}, "*FooBar"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ctx.goType(tc.typeSpec)
			if got != tc.want {
				t.Errorf("goType(%v) = %q, want %q", tc.typeSpec.Kind, got, tc.want)
			}
		})
	}
}

func TestGenContextGoTypeSharedTypes(t *testing.T) {
	ctx := newGenContextWithSharedTypes("gen", []string{"HttpEndpoint"})

	got := ctx.goType(TypeSpec{Kind: "message", MessageType: "HttpEndpoint"})
	want := "*types.HttpEndpoint"
	if got != want {
		t.Errorf("goType(shared HttpEndpoint) = %q, want %q", got, want)
	}

	ctxTypes := newGenContext("types")
	ctxTypes.sharedTypes["HttpEndpoint"] = struct{}{}
	got = ctxTypes.goType(TypeSpec{Kind: "message", MessageType: "HttpEndpoint"})
	want = "*HttpEndpoint"
	if got != want {
		t.Errorf("goType(shared HttpEndpoint in types pkg) = %q, want %q", got, want)
	}
}

func TestGenContextGoTypeWellKnown(t *testing.T) {
	ctx := newGenContext("gen")

	tests := []struct {
		messageType string
		wantSuffix  string
	}{
		{"Timestamp", "*timestamppb.Timestamp"},
		{"Duration", "*durationpb.Duration"},
		{"Any", "*anypb.Any"},
		{"Empty", "*emptypb.Empty"},
		{"FieldMask", "*fieldmaskpb.FieldMask"},
		{"Value", "*structpb.Value"},
		{"ListValue", "*structpb.ListValue"},
	}

	for _, tc := range tests {
		t.Run(tc.messageType, func(t *testing.T) {
			got := ctx.goType(TypeSpec{Kind: "message", MessageType: tc.messageType})
			if got != tc.wantSuffix {
				t.Errorf("goType(well-known %s) = %q, want %q", tc.messageType, got, tc.wantSuffix)
			}
		})
	}
}

func TestGenContextIsWellKnownProtoType(t *testing.T) {
	ctx := newGenContext("gen")

	wellKnown := []string{
		"Timestamp", "Duration", "Any", "Empty", "FieldMask",
		"Value", "ListValue", "NullValue",
		"BoolValue", "Int32Value", "Int64Value", "UInt32Value", "UInt64Value",
		"FloatValue", "DoubleValue", "StringValue", "BytesValue",
	}
	for _, name := range wellKnown {
		if !ctx.isWellKnownProtoType(name) {
			t.Errorf("isWellKnownProtoType(%q) = false, want true", name)
		}
	}

	notWellKnown := []string{"FooBar", "Agent", "Skill", ""}
	for _, name := range notWellKnown {
		if ctx.isWellKnownProtoType(name) {
			t.Errorf("isWellKnownProtoType(%q) = true, want false", name)
		}
	}
}

func TestGenContextSingularize(t *testing.T) {
	ctx := newGenContext("gen")

	tests := []struct {
		input string
		want  string
	}{
		{"Headers", "Header"},
		{"Skills", "Skill"},
		{"Environments", "Environment"},
		{"Entries", "Entry"},
		{"Addresses", "Address"},
		{"Children", "Child"},
		{"People", "Person"},
		{"Men", "Man"},
		{"Women", "Woman"},
		{"Address", "Address"},
		{"Bus", "Bu"},
		{"Buss", "Buss"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := ctx.singularize(tc.input)
			if got != tc.want {
				t.Errorf("singularize(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestGenContextPluralize(t *testing.T) {
	ctx := newGenContext("gen")

	tests := []struct {
		input string
		want  string
	}{
		{"Header", "Headers"},
		{"Skill", "Skills"},
		{"Entry", "Entries"},
		{"Address", "Addresses"},
		{"Child", "Children"},
		{"Person", "People"},
		{"Man", "Men"},
		{"Woman", "Women"},
		{"Key", "Keys"},
		{"Fox", "Foxes"},
		{"Batch", "Batches"},
		{"Bush", "Bushes"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := ctx.pluralize(tc.input)
			if got != tc.want {
				t.Errorf("pluralize(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestGenContextNeedsCoercion(t *testing.T) {
	ctx := newGenContext("gen")

	tests := []struct {
		name string
		spec *TypeSpec
		want bool
	}{
		{"nil", nil, false},
		{"string", &TypeSpec{Kind: "string"}, true},
		{"int32", &TypeSpec{Kind: "int32"}, false},
		{"bool", &TypeSpec{Kind: "bool"}, false},
		{"message", &TypeSpec{Kind: "message"}, false},
		{"map string->string", &TypeSpec{Kind: "map", ValueType: &TypeSpec{Kind: "string"}}, true},
		{"map string->int32", &TypeSpec{Kind: "map", ValueType: &TypeSpec{Kind: "int32"}}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ctx.needsCoercion(tc.spec)
			if got != tc.want {
				t.Errorf("needsCoercion(%v) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// ============================================================================
// sdk_client.go pure functions
// ============================================================================

func TestDeriveApiVersion(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai.stigmer.agentic.agent.v1", "agentic.stigmer.ai/v1"},
		{"ai.stigmer.iam.apikey.v1", "iam.stigmer.ai/v1"},
		{"ai.stigmer.tenancy.organization.v1", "tenancy.stigmer.ai/v1"},
		{"too.short", "stigmer.ai/v1"},
		{"a.b.c.d", "stigmer.ai/v1"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := deriveApiVersion(tc.input)
			if got != tc.want {
				t.Errorf("deriveApiVersion(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestDeriveGoImportPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{
			"ai.stigmer.agentic.agent.v1",
			"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agent/v1",
		},
		{
			"ai.stigmer.commons.apiresource",
			"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := deriveGoImportPath(tc.input)
			if got != tc.want {
				t.Errorf("deriveGoImportPath(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestPascalToSnake(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Agent", "agent"},
		{"AgentExecution", "agent_execution"},
		{"McpServer", "mcp_server"},
		{"WorkflowInstance", "workflow_instance"},
		{"Skill", "skill"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := pascalToSnake(tc.input)
			if got != tc.want {
				t.Errorf("pascalToSnake(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestResolveResourceKind(t *testing.T) {
	tests := []struct {
		name   string
		schema *ServiceSchemaFile
		want   string
	}{
		{
			name: "exact match from enum - oauth_app",
			schema: &ServiceSchemaFile{
				Resource: "oauthapp",
				EnumTypes: []EnumSchema{{
					Name: "ApiResourceKind",
					Values: []EnumValueSchema{
						{Name: "agent", Number: 40},
						{Name: "oauth_app", Number: 22},
					},
				}},
			},
			want: "oauth_app",
		},
		{
			name: "exact match from enum - agent",
			schema: &ServiceSchemaFile{
				Resource: "agent",
				EnumTypes: []EnumSchema{{
					Name: "ApiResourceKind",
					Values: []EnumValueSchema{
						{Name: "agent", Number: 40},
						{Name: "oauth_app", Number: 22},
					},
				}},
			},
			want: "agent",
		},
		{
			name: "exact match from enum - mcp_server",
			schema: &ServiceSchemaFile{
				Resource: "mcpserver",
				EnumTypes: []EnumSchema{{
					Name: "ApiResourceKind",
					Values: []EnumValueSchema{
						{Name: "mcp_server", Number: 44},
					},
				}},
			},
			want: "mcp_server",
		},
		{
			name: "fallback when no ApiResourceKind enum",
			schema: &ServiceSchemaFile{
				Resource:  "agent",
				EnumTypes: []EnumSchema{},
			},
			want: "agent",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveResourceKind(tc.schema)
			if got != tc.want {
				t.Errorf("resolveResourceKind() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestIsSpecialType(t *testing.T) {
	specials := []string{"EnvironmentSpec", "EnvironmentValue", "ExecutionValue", "ApiResourceReference"}
	for _, name := range specials {
		if !isSpecialType(name) {
			t.Errorf("isSpecialType(%q) = false, want true", name)
		}
	}

	nonSpecials := []string{"Agent", "Skill", "FooBar", ""}
	for _, name := range nonSpecials {
		if isSpecialType(name) {
			t.Errorf("isSpecialType(%q) = true, want false", name)
		}
	}
}

func TestIsEmptyType(t *testing.T) {
	if !isEmptyType("google.protobuf.Empty") {
		t.Error("isEmptyType(google.protobuf.Empty) = false, want true")
	}
	if isEmptyType("some.other.Type") {
		t.Error("isEmptyType(some.other.Type) = true, want false")
	}
	if isEmptyType("") {
		t.Error("isEmptyType(\"\") = true, want false")
	}
}

func TestIsIDType(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"AgentId", true},
		{"WorkflowID", true},
		{"AgentSpec", false},
		{"", false},
		{"ApiResourceId", true},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := isIDType(tc.input)
			if got != tc.want {
				t.Errorf("isIDType(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}

func TestGoProtoFieldName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"name", "Name"},
		{"api_version", "ApiVersion"},
		{"tool_approval_policy", "ToolApprovalPolicy"},
		{"base_url", "BaseUrl"},
		{"resource_id", "ResourceId"},
		{"summary_md", "SummaryMd"},
		{"cost_usd", "CostUsd"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := goProtoFieldName(tc.input)
			if got != tc.want {
				t.Errorf("goProtoFieldName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestResolveType(t *testing.T) {
	tests := []struct {
		name      string
		fullType  string
		shortType string
		pkg       string
		alias     string
		wantPkg   string
		wantType  string
	}{
		{
			"empty type", "google.protobuf.Empty", "Empty",
			"ai.stigmer.agentic.agent.v1", "agentv1",
			"emptypb", "Empty",
		},
		{
			"same package", "ai.stigmer.agentic.agent.v1.AgentSpec", "AgentSpec",
			"ai.stigmer.agentic.agent.v1", "agentv1",
			"agentv1", "AgentSpec",
		},
		{
			"commons type", "ai.stigmer.commons.apiresource.ApiResourceReference", "ApiResourceReference",
			"ai.stigmer.agentic.agent.v1", "agentv1",
			"apiresource", "ApiResourceReference",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotPkg, gotType := resolveType(tc.fullType, tc.shortType, tc.pkg, tc.alias)
			if gotPkg != tc.wantPkg || gotType != tc.wantType {
				t.Errorf("resolveType(%q, %q, %q, %q) = (%q, %q), want (%q, %q)",
					tc.fullType, tc.shortType, tc.pkg, tc.alias,
					gotPkg, gotType, tc.wantPkg, tc.wantType)
			}
		})
	}
}

// ============================================================================
// sdk_client_ts.go pure functions
// ============================================================================

func TestDeriveTSImportBase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai.stigmer.agentic.agent.v1", "@stigmer/protos/ai/stigmer/agentic/agent/v1"},
		{"ai.stigmer.commons.apiresource", "@stigmer/protos/ai/stigmer/commons/apiresource"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := deriveTSImportBase(tc.input)
			if got != tc.want {
				t.Errorf("deriveTSImportBase(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTsProtoFieldName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"name", "name"},
		{"api_version", "apiVersion"},
		{"tool_approval_policy", "toolApprovalPolicy"},
		{"single", "single"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := tsProtoFieldName(tc.input)
			if got != tc.want {
				t.Errorf("tsProtoFieldName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTsClientFieldName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"agentchannel", "agentChannel"},
		{"agentexecution", "agentExecution"},
		{"agentinstance", "agentInstance"},
		{"agentshare", "agentShare"},
		{"executioncontext", "executionContext"},
		{"mcpserver", "mcpServer"},
		{"workflowexecution", "workflowExecution"},
		{"apikey", "apiKey"},
		{"agent", "agent"},
		{"skill", "skill"},
		{"unknownresource", "unknownresource"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := tsClientFieldName(tc.input)
			if got != tc.want {
				t.Errorf("tsClientFieldName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTsProtoFileToSuffix(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"apis/ai/stigmer/agentic/agent/v1/spec.proto", "spec_pb"},
		{"apis/ai/stigmer/commons/apiresource/io.proto", "io_pb"},
		{"foo/bar/enum.proto", "enum_pb"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := tsProtoFileToSuffix(tc.input)
			if got != tc.want {
				t.Errorf("tsProtoFileToSuffix(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTsResolveEnumImport(t *testing.T) {
	saved := tsApisDir
	tsApisDir = "../../../apis"
	defer func() { tsApisDir = saved }()

	tests := []struct {
		input    string
		wantFrom string
		wantName string
	}{
		{
			"ai.stigmer.agentic.workflow.v1.WorkflowTaskKind",
			"@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb",
			"WorkflowTaskKind",
		},
		{
			"ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind",
			"@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/spec_pb",
			"ApiResourceKind",
		},
		{
			"ai.stigmer.iam.oauthapp.v1.VendorApprovalStatus",
			"@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb",
			"VendorApprovalStatus",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			gotFrom, gotName := tsResolveEnumImport(tc.input)
			if gotFrom != tc.wantFrom || gotName != tc.wantName {
				t.Errorf("tsResolveEnumImport(%q) = (%q, %q), want (%q, %q)",
					tc.input, gotFrom, gotName, tc.wantFrom, tc.wantName)
			}
		})
	}
}

func TestIsCommonsType(t *testing.T) {
	if !isCommonsType("ai.stigmer.commons.apiresource.ApiResourceReference") {
		t.Error("isCommonsType(ai.stigmer.commons...) = false, want true")
	}
	if isCommonsType("ai.stigmer.agentic.agent.v1.Agent") {
		t.Error("isCommonsType(ai.stigmer.agentic...) = true, want false")
	}
	if isCommonsType("") {
		t.Error("isCommonsType(\"\") = true, want false")
	}
}

func TestTsMethodName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Apply", "apply"},
		{"GetByReference", "getByReference"},
		{"Create", "create"},
		{"", ""},
		{"a", "a"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := tsMethodName(tc.input)
			if got != tc.want {
				t.Errorf("tsMethodName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// ============================================================================
// sdk_client_python.go pure functions
// ============================================================================

func TestPyMethodName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Apply", "apply"},
		{"GetByReference", "get_by_reference"},
		{"Create", "create"},
		{"DeleteAll", "delete_all"},
		{"ListMCPServers", "list_mcp_servers"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := pyMethodName(tc.input)
			if got != tc.want {
				t.Errorf("pyMethodName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestPyStubMethodName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Apply", "apply"},
		{"GetByReference", "getByReference"},
		{"Create", "create"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := pyStubMethodName(tc.input)
			if got != tc.want {
				t.Errorf("pyStubMethodName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestPyClientFieldName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"agent", "agents"},
		{"agentchannel", "agent_channels"},
		{"agentexecution", "agent_executions"},
		{"agentshare", "agent_shares"},
		{"mcpserver", "mcp_servers"},
		{"apikey", "api_keys"},
		{"skill", "skills"},
		{"iampolicy", "iam_policies"},
		{"unknownresource", "unknownresources"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := pyClientFieldName(tc.input)
			if got != tc.want {
				t.Errorf("pyClientFieldName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestPyTypeForTypeSpec(t *testing.T) {
	tests := []struct {
		name string
		spec *TypeSpec
		want string
	}{
		{"string", &TypeSpec{Kind: "string"}, "str"},
		{"string with enum", &TypeSpec{Kind: "string", EnumType: "some.Enum"}, "int"},
		{"int32", &TypeSpec{Kind: "int32"}, "int"},
		{"uint32", &TypeSpec{Kind: "uint32"}, "int"},
		{"int64", &TypeSpec{Kind: "int64"}, "int"},
		{"bool", &TypeSpec{Kind: "bool"}, "bool"},
		{"float", &TypeSpec{Kind: "float"}, "float"},
		{"double", &TypeSpec{Kind: "double"}, "float"},
		{"bytes", &TypeSpec{Kind: "bytes"}, "bytes"},
		{"timestamp", &TypeSpec{Kind: "timestamp"}, "str"},
		{"struct", &TypeSpec{Kind: "struct"}, "dict[str, Any]"},
		{"array of strings", &TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "string"}}, "list[str]"},
		{"array nil element", &TypeSpec{Kind: "array"}, "list[str]"},
		{"map", &TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "string"}}, "dict[str, str]"},
		{"message EnvironmentSpec", &TypeSpec{Kind: "message", MessageType: "EnvironmentSpec"}, "EnvSpecInput"},
		{"message EnvironmentValue", &TypeSpec{Kind: "message", MessageType: "EnvironmentValue"}, "EnvVarInput"},
		{"message ApiResourceReference", &TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}, "ResourceRef"},
		{"message generic", &TypeSpec{Kind: "message", MessageType: "FooBar"}, "FooBarInput"},
		{"unknown", &TypeSpec{Kind: "unknown"}, "str"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := pyTypeForTypeSpec(tc.spec)
			if got != tc.want {
				t.Errorf("pyTypeForTypeSpec(%s) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestPyDefaultForTypeSpec(t *testing.T) {
	tests := []struct {
		name string
		spec *TypeSpec
		want string
	}{
		{"string", &TypeSpec{Kind: "string"}, `""`},
		{"string with enum", &TypeSpec{Kind: "string", EnumType: "some.Enum"}, "0"},
		{"int32", &TypeSpec{Kind: "int32"}, "0"},
		{"bool", &TypeSpec{Kind: "bool"}, "False"},
		{"float", &TypeSpec{Kind: "float"}, "0.0"},
		{"bytes", &TypeSpec{Kind: "bytes"}, `b""`},
		{"struct", &TypeSpec{Kind: "struct"}, "field(default_factory=dict)"},
		{"array", &TypeSpec{Kind: "array"}, "field(default_factory=list)"},
		{"map", &TypeSpec{Kind: "map"}, "field(default_factory=dict)"},
		{"message", &TypeSpec{Kind: "message"}, "None"},
		{"timestamp", &TypeSpec{Kind: "timestamp"}, `""`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := pyDefaultForTypeSpec(tc.spec)
			if got != tc.want {
				t.Errorf("pyDefaultForTypeSpec(%s) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestPyDefaultForField(t *testing.T) {
	required := &FieldSchema{Required: true, Type: TypeSpec{Kind: "string"}}
	if got := pyDefaultForField(required); got != "" {
		t.Errorf("pyDefaultForField(required) = %q, want \"\"", got)
	}

	optional := &FieldSchema{Required: false, Type: TypeSpec{Kind: "string"}}
	if got := pyDefaultForField(optional); got != `""` {
		t.Errorf("pyDefaultForField(optional string) = %q, want %q", got, `""`)
	}
}

func TestPyIsNullableType(t *testing.T) {
	if !pyIsNullableType(&TypeSpec{Kind: "message"}) {
		t.Error("pyIsNullableType(message) = false, want true")
	}
	if pyIsNullableType(&TypeSpec{Kind: "string"}) {
		t.Error("pyIsNullableType(string) = true, want false")
	}
}

func TestPyNeedsFieldImport(t *testing.T) {
	needsField := []string{"struct", "array", "map"}
	for _, kind := range needsField {
		if !pyNeedsFieldImport(&TypeSpec{Kind: kind}) {
			t.Errorf("pyNeedsFieldImport(%s) = false, want true", kind)
		}
	}
	noField := []string{"string", "int32", "bool", "message"}
	for _, kind := range noField {
		if pyNeedsFieldImport(&TypeSpec{Kind: kind}) {
			t.Errorf("pyNeedsFieldImport(%s) = true, want false", kind)
		}
	}
}

func TestPyFieldName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"name", "name"},
		{"from", "from_"},
		{"class", "class_"},
		{"import", "import_"},
		{"type", "type"},
		{"regular_field", "regular_field"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := pyFieldName(tc.input)
			if got != tc.want {
				t.Errorf("pyFieldName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestPyIsScalarKind(t *testing.T) {
	scalars := []string{"string", "int32", "uint32", "int64", "bool", "float", "double", "bytes"}
	for _, kind := range scalars {
		if !pyIsScalarKind(kind) {
			t.Errorf("pyIsScalarKind(%q) = false, want true", kind)
		}
	}
	nonScalars := []string{"message", "array", "map", "struct", "timestamp", ""}
	for _, kind := range nonScalars {
		if pyIsScalarKind(kind) {
			t.Errorf("pyIsScalarKind(%q) = true, want false", kind)
		}
	}
}

// ============================================================================
// sdk_client_java.go pure functions
// ============================================================================

func TestJavaCapCamel(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"tool_approval_policy", "ToolApprovalPolicy"},
		{"name", "Name"},
		{"base_url", "BaseUrl"},
		{"resource_id", "ResourceId"},
		{"summary_md", "SummaryMd"},
		{"cost_usd", "CostUsd"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := javaCapCamel(tc.input)
			if got != tc.want {
				t.Errorf("javaCapCamel(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestJavaCamel(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"tool_approval_policy", "toolApprovalPolicy"},
		{"name", "name"},
		{"base_url", "baseUrl"},
		{"resource_id", "resourceId"},
		{"", ""},
		// Java keywords must be escaped with a trailing underscore
		// (broke the v3.3.0 Maven publish via FieldDeclaration.default).
		{"default", "default_"},
		{"class", "class_"},
		{"static", "static_"},
		{"null", "null_"},
		// java.lang.Object method names too: `Builder equals(Object)` is an
		// invalid override of Object.equals.
		{"equals", "equals_"},
		{"hash_code", "hashCode_"},
		{"to_string", "toString_"},
		{"wait", "wait_"},
		// ...but only exact collisions: multi-part names that merely
		// contain a reserved name camel-case away from it.
		{"default_value", "defaultValue"},
		{"catch_all", "catchAll"},
		{"equals_any", "equalsAny"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := javaCamel(tc.input)
			if got != tc.want {
				t.Errorf("javaCamel(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestJavaSetterName(t *testing.T) {
	if got := javaSetterName("name"); got != "setName" {
		t.Errorf("javaSetterName(\"name\") = %q, want \"setName\"", got)
	}
	if got := javaSetterName("base_url"); got != "setBaseUrl" {
		t.Errorf("javaSetterName(\"base_url\") = %q, want \"setBaseUrl\"", got)
	}
}

func TestJavaAddAllName(t *testing.T) {
	if got := javaAddAllName("skills"); got != "addAllSkills" {
		t.Errorf("javaAddAllName(\"skills\") = %q, want \"addAllSkills\"", got)
	}
}

func TestJavaAddName(t *testing.T) {
	if got := javaAddName("skill_refs"); got != "addSkillRefs" {
		t.Errorf("javaAddName(\"skill_refs\") = %q, want \"addSkillRefs\"", got)
	}
}

func TestJavaPutName(t *testing.T) {
	if got := javaPutName("labels"); got != "putLabels" {
		t.Errorf("javaPutName(\"labels\") = %q, want \"putLabels\"", got)
	}
}

func TestJavaPutAllName(t *testing.T) {
	if got := javaPutAllName("labels"); got != "putAllLabels" {
		t.Errorf("javaPutAllName(\"labels\") = %q, want \"putAllLabels\"", got)
	}
}

func TestJavaMethodLower(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Apply", "apply"},
		{"GetByReference", "getByReference"},
		{"", ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := javaMethodLower(tc.input)
			if got != tc.want {
				t.Errorf("javaMethodLower(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestJavaAccessorName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"agent", "agents"},
		{"apikey", "apiKeys"},
		{"iampolicy", "iamPolicies"},
		{"skill", "skills"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := javaAccessorName(tc.input)
			if got != tc.want {
				t.Errorf("javaAccessorName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestResolveJavaFQCN(t *testing.T) {
	if got := resolveJavaFQCN("google.protobuf.Empty"); got != "com.google.protobuf.Empty" {
		t.Errorf("resolveJavaFQCN(google.protobuf.Empty) = %q, want com.google.protobuf.Empty", got)
	}
	if got := resolveJavaFQCN("ai.stigmer.agentic.agent.v1.Agent"); got != "ai.stigmer.agentic.agent.v1.Agent" {
		t.Errorf("resolveJavaFQCN(Agent) = %q, want passthrough", got)
	}
}

func TestJavaBoxed(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"int", "Integer"},
		{"long", "Long"},
		{"boolean", "Boolean"},
		{"float", "Float"},
		{"double", "Double"},
		{"String", "String"},
		{"FooBar", "FooBar"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := javaBoxed(tc.input)
			if got != tc.want {
				t.Errorf("javaBoxed(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestJavaIsPrimitive(t *testing.T) {
	primitives := []string{"int", "long", "boolean", "float", "double"}
	for _, p := range primitives {
		if !javaIsPrimitive(p) {
			t.Errorf("javaIsPrimitive(%q) = false, want true", p)
		}
	}
	nonPrimitives := []string{"String", "Integer", "FooBar"}
	for _, p := range nonPrimitives {
		if javaIsPrimitive(p) {
			t.Errorf("javaIsPrimitive(%q) = true, want false", p)
		}
	}
}

func TestJavaTypeForTypeSpec(t *testing.T) {
	typeMap := make(map[string]*TypeSchema)

	tests := []struct {
		name string
		spec *TypeSpec
		want string
	}{
		{"string", &TypeSpec{Kind: "string"}, "String"},
		{"string with enum", &TypeSpec{Kind: "string", EnumType: "ai.stigmer.Foo.MyEnum"}, "MyEnum"},
		{"int32", &TypeSpec{Kind: "int32"}, "int"},
		{"uint32", &TypeSpec{Kind: "uint32"}, "int"},
		{"int64", &TypeSpec{Kind: "int64"}, "long"},
		{"bool", &TypeSpec{Kind: "bool"}, "boolean"},
		{"float", &TypeSpec{Kind: "float"}, "float"},
		{"double", &TypeSpec{Kind: "double"}, "double"},
		{"bytes", &TypeSpec{Kind: "bytes"}, "byte[]"},
		{"timestamp", &TypeSpec{Kind: "timestamp"}, "String"},
		{"struct", &TypeSpec{Kind: "struct"}, "java.util.Map<String, Object>"},
		{"array of strings", &TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "string"}}, "java.util.List<String>"},
		{"array of int", &TypeSpec{Kind: "array", ElementType: &TypeSpec{Kind: "int32"}}, "java.util.List<Integer>"},
		{"array nil", &TypeSpec{Kind: "array"}, "java.util.List<String>"},
		{"map string->string", &TypeSpec{Kind: "map", KeyType: &TypeSpec{Kind: "string"}, ValueType: &TypeSpec{Kind: "string"}}, "java.util.Map<String, String>"},
		{"message EnvironmentSpec", &TypeSpec{Kind: "message", MessageType: "EnvironmentSpec"}, "EnvSpecInput"},
		{"message EnvironmentValue", &TypeSpec{Kind: "message", MessageType: "EnvironmentValue"}, "EnvVarInput"},
		{"message ApiResourceReference", &TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}, "ResourceRef"},
		{"message generic", &TypeSpec{Kind: "message", MessageType: "FooBar"}, "FooBarInput"},
		{"unknown", &TypeSpec{Kind: "unknown"}, "String"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := javaTypeForTypeSpec(tc.spec, typeMap)
			if got != tc.want {
				t.Errorf("javaTypeForTypeSpec(%s) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestResolveJavaEnumImport(t *testing.T) {
	if got := resolveJavaEnumImport("ai.stigmer.agentic.Foo"); got != "ai.stigmer.agentic.Foo" {
		t.Errorf("resolveJavaEnumImport = %q, want passthrough", got)
	}
}

// ============================================================================
// mcp.go pure functions
// ============================================================================

func TestScalarGoType(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"string", "string"},
		{"bool", "bool"},
		{"int32", "int32"},
		{"uint32", "uint32"},
		{"int64", "int64"},
		{"float", "float32"},
		{"double", "float64"},
		{"bytes", "[]byte"},
		{"unknown", "string"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := scalarGoType(tc.input)
			if got != tc.want {
				t.Errorf("scalarGoType(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestIsScalarSlice(t *testing.T) {
	scalars := []string{"[]string", "[]bool", "[]int32", "[]uint32", "[]int64", "[]float32", "[]float64", "[]byte"}
	for _, s := range scalars {
		if !isScalarSlice(s) {
			t.Errorf("isScalarSlice(%q) = false, want true", s)
		}
	}

	nonScalars := []string{"[]*FooInput", "[]map[string]string", "map[string]string", "*FooInput"}
	for _, s := range nonScalars {
		if isScalarSlice(s) {
			t.Errorf("isScalarSlice(%q) = true, want false", s)
		}
	}
}

func TestParseMapType(t *testing.T) {
	tests := []struct {
		input   string
		wantKey string
		wantVal string
	}{
		{"map[string]*FooInput", "string", "*FooInput"},
		{"map[string]string", "string", "string"},
		{"map[int32]bool", "int32", "bool"},
		{"notamap", "string", "string"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			gotKey, gotVal := parseMapType(tc.input)
			if gotKey != tc.wantKey || gotVal != tc.wantVal {
				t.Errorf("parseMapType(%q) = (%q, %q), want (%q, %q)",
					tc.input, gotKey, gotVal, tc.wantKey, tc.wantVal)
			}
		})
	}
}

func TestToPascalCase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"http_call", "HttpCall"},
		{"agent_execution", "AgentExecution"},
		{"single", "Single"},
		{"", ""},
		{"a_b_c", "ABC"},
		{"fork_join_all", "ForkJoinAll"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := toPascalCase(tc.input)
			if got != tc.want {
				t.Errorf("toPascalCase(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestSingularizeMcp(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"SkillRefs", "SkillRef"},
		{"Entries", "Entry"},
		{"Addresses", "Address"},
		{"Skills", "Skill"},
		{"Address", "Address"},
		{"Bus", "Bu"},
		{"Buss", "Buss"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := singularize(tc.input)
			if got != tc.want {
				t.Errorf("singularize(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestProtoTypeName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"ai.stigmer.agentic.agent.v1.AgentSpec", "AgentSpec"},
		{"ai.stigmer.commons.apiresource.ApiResourceReference", "ApiResourceReference"},
		{"SimpleType", "SimpleType"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := protoTypeName(tc.input)
			if got != tc.want {
				t.Errorf("protoTypeName(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
