package main

import (
	"bytes"
	"testing"
)

// ============================================================================
// sdk_client_ts_update_input.go — toXxxUpdateInput emission
// ============================================================================

func TestTSHasUpdateRPC(t *testing.T) {
	withUpdate := &ServiceSchemaFile{
		Services: []ServiceDefinition{{
			Role: "command",
			Methods: []MethodSchema{
				{Name: "Create", InputType: "Widget"},
				{Name: "Update", InputType: "Widget"},
			},
		}},
	}
	withoutUpdate := &ServiceSchemaFile{
		Services: []ServiceDefinition{{
			Role:    "command",
			Methods: []MethodSchema{{Name: "Create", InputType: "Widget"}},
		}},
	}
	// An Update RPC that takes something other than the resource (e.g. a
	// field-level UpdateVisibility) must not count.
	fieldLevelUpdate := &ServiceSchemaFile{
		Services: []ServiceDefinition{{
			Role:    "command",
			Methods: []MethodSchema{{Name: "Update", InputType: "WidgetVisibilityInput"}},
		}},
	}

	cfg := sdkResourceConfig{protoResType: "Widget"}
	if !tsHasUpdateRPC(withUpdate, cfg) {
		t.Error("expected update RPC to be detected")
	}
	if tsHasUpdateRPC(withoutUpdate, cfg) {
		t.Error("expected no update RPC without an Update method")
	}
	if tsHasUpdateRPC(fieldLevelUpdate, cfg) {
		t.Error("expected non-resource Update input to be ignored")
	}
}

func TestTSUpdateInputFieldExpr(t *testing.T) {
	tests := []struct {
		name  string
		field *FieldSchema
		want  string
	}{
		{
			name:  "optional string normalizes default to undefined",
			field: field("Description", "description", "description", TypeSpec{Kind: "string"}),
			want:  "msg.description || undefined",
		},
		{
			name:  "required string passes through with zero fallback",
			field: requiredField("IdpId", "idpId", "idp_id", TypeSpec{Kind: "string"}),
			want:  `msg.idpId ?? ""`,
		},
		{
			name:  "optional enum normalizes zero to undefined",
			field: field("Mode", "mode", "mode", TypeSpec{Kind: "string", EnumType: "ai.stigmer.agentic.widget.v1.Mode"}),
			want:  "msg.mode || undefined",
		},
		{
			name:  "optional bool normalizes false to undefined",
			field: field("IsPersonal", "isPersonal", "is_personal", TypeSpec{Kind: "bool"}),
			want:  "msg.isPersonal || undefined",
		},
		{
			name:  "optional int64 normalizes zero to undefined",
			field: field("MaxCostMicros", "maxCostMicros", "max_cost_micros", TypeSpec{Kind: "int64"}),
			want:  "msg.maxCostMicros || undefined",
		},
		{
			name:  "optional bytes normalizes empty to undefined",
			field: field("CallbackToken", "callbackToken", "callback_token", TypeSpec{Kind: "bytes"}),
			want:  "msg.callbackToken?.length ? msg.callbackToken : undefined",
		},
		{
			name:  "required scalar falls back to its zero value",
			field: requiredField("Command", "command", "command", TypeSpec{Kind: "string"}),
			want:  `msg.command ?? ""`,
		},
		{
			name:  "optional timestamp maps to Date",
			field: field("ExpiresAt", "expiresAt", "expires_at", TypeSpec{Kind: "timestamp"}),
			want:  "msg.expiresAt ? timestampDate(msg.expiresAt) : undefined",
		},
		{
			name:  "optional struct passes through",
			field: field("Schema", "schema", "schema", TypeSpec{Kind: "struct"}),
			want:  "msg.schema",
		},
		{
			name:  "required struct falls back to empty object",
			field: requiredField("TaskConfig", "taskConfig", "task_config", TypeSpec{Kind: "struct"}),
			want:  "msg.taskConfig ?? {}",
		},
		{
			name:  "optional nested message via helper",
			field: field("Preferences", "preferences", "preferences", TypeSpec{Kind: "message", MessageType: "WidgetPreferences"}),
			want:  "msg.preferences ? toWidgetPreferencesInput(msg.preferences) : undefined",
		},
		{
			name:  "required nested message defaults an absent proto",
			field: requiredField("Document", "document", "document", TypeSpec{Kind: "message", MessageType: "WidgetDocument"}),
			want:  "toWidgetDocumentInput(msg.document ?? create(WidgetDocumentSchema))",
		},
		{
			name:  "optional resource ref via shared helper",
			field: field("AgentRef", "agentRef", "agent_ref", TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}),
			want:  "toResourceRefInput(msg.agentRef)",
		},
		{
			name:  "required resource ref falls back to empty ref",
			field: requiredField("McpServerRef", "mcpServerRef", "mcp_server_ref", TypeSpec{Kind: "message", MessageType: "ApiResourceReference"}),
			want:  `toResourceRefInput(msg.mcpServerRef) ?? { org: "", slug: "" }`,
		},
		{
			name:  "environment spec via shared helper",
			field: field("Environment", "environment", "environment", TypeSpec{Kind: "message", MessageType: "EnvironmentSpec"}),
			want:  "toEnvSpecInput(msg.environment)",
		},
		{
			name: "repeated resource refs via shared helper",
			field: field("SkillRefs", "skillRefs", "skill_refs", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "ApiResourceReference"},
			}),
			want: "toResourceRefInputs(msg.skillRefs)",
		},
		{
			name: "repeated message maps elements and normalizes empty",
			field: field("Tasks", "tasks", "tasks", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "message", MessageType: "WidgetTask"},
			}),
			want: "msg.tasks?.length ? msg.tasks.map(toWidgetTaskInput) : undefined",
		},
		{
			name: "repeated scalar copies and normalizes empty",
			field: field("Scopes", "scopes", "scopes", TypeSpec{
				Kind:        "array",
				ElementType: &TypeSpec{Kind: "string"},
			}),
			want: "msg.scopes?.length ? [...msg.scopes] : undefined",
		},
		{
			name: "string map copies and normalizes empty",
			field: field("Metadata", "metadata", "metadata", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "string"},
			}),
			want: "Object.keys(msg.metadata ?? {}).length > 0 ? { ...msg.metadata } : undefined",
		},
		{
			name: "environment value map via shared helper",
			field: field("Variables", "variables", "variables", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "EnvironmentValue"},
			}),
			want: "toEnvVarInputMap(msg.variables)",
		},
		{
			name: "execution value map via shared helper",
			field: field("Values", "values", "values", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "ExecutionValue"},
			}),
			want: "toExecVarInputMap(msg.values)",
		},
		{
			name: "message map maps values and normalizes empty",
			field: field("Env", "env", "env", TypeSpec{
				Kind:      "map",
				KeyType:   &TypeSpec{Kind: "string"},
				ValueType: &TypeSpec{Kind: "message", MessageType: "EnvVarDeclaration"},
			}),
			want: "Object.keys(msg.env ?? {}).length > 0 ? Object.fromEntries(Object.entries(msg.env).map(([k, v]) => [k, toEnvVarDeclarationInput(v)])) : undefined",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			imports := newTSImportSet()
			access := "msg." + tsProtoFieldName(tt.field.ProtoField)
			got := tsUpdateInputFieldExpr(tt.field, access, nil, imports)
			if got != tt.want {
				t.Errorf("expression mismatch\n got: %s\nwant: %s", got, tt.want)
			}
		})
	}
}

func TestTSUpdateInputOneofExpr(t *testing.T) {
	typeMap := map[string]*TypeSchema{
		"GitRepoSource": {Name: "GitRepoSource"},
	}

	messageMember := field("GitRepo", "gitRepo", "git_repo", TypeSpec{Kind: "message", MessageType: "GitRepoSource"})
	messageMember.OneofGroup = "source"
	imports := newTSImportSet()
	got := tsUpdateInputOneofExpr(messageMember, "msg", typeMap, imports)
	want := `msg.source?.case === "gitRepo" ? toGitRepoSourceInput(msg.source.value) : undefined`
	if got != want {
		t.Errorf("oneof message member mismatch\n got: %s\nwant: %s", got, want)
	}

	refMember := field("AgentRef", "agentRef", "agent_ref", TypeSpec{Kind: "message", MessageType: "ApiResourceReference"})
	refMember.OneofGroup = "target"
	got = tsUpdateInputOneofExpr(refMember, "msg", typeMap, imports)
	want = `msg.target?.case === "agentRef" ? toResourceRefInput(msg.target.value) : undefined`
	if got != want {
		t.Errorf("oneof ref member mismatch\n got: %s\nwant: %s", got, want)
	}

	// Snake-case oneof groups camelize (channelapp's provider_config).
	snakeMember := field("Slack", "slack", "slack", TypeSpec{Kind: "message", MessageType: "GitRepoSource"})
	snakeMember.OneofGroup = "provider_config"
	got = tsUpdateInputOneofExpr(snakeMember, "msg", typeMap, imports)
	want = `msg.providerConfig?.case === "slack" ? toGitRepoSourceInput(msg.providerConfig.value) : undefined`
	if got != want {
		t.Errorf("oneof snake group mismatch\n got: %s\nwant: %s", got, want)
	}
}

func TestGenerateTSUpdateInputMapper(t *testing.T) {
	schema := &ServiceSchemaFile{
		Resource: "widget",
		Package:  "ai.stigmer.agentic.widget.v1",
		Services: []ServiceDefinition{{
			Role:    "command",
			Methods: []MethodSchema{{Name: "Update", InputType: "Widget"}},
		}},
	}
	cfg := sdkResourceConfig{
		protoResType: "Widget",
		inputPrefix:  "Widget",
		isVersioned:  true,
	}
	spec := &TaskConfigSchema{
		Name: "WidgetSpec",
		Fields: []*FieldSchema{
			field("Description", "description", "description", TypeSpec{Kind: "string"}),
			field("Preferences", "preferences", "preferences", TypeSpec{Kind: "message", MessageType: "WidgetPreferences"}),
		},
	}
	typeMap := map[string]*TypeSchema{
		"WidgetPreferences": {
			Name:      "WidgetPreferences",
			ProtoType: "ai.stigmer.agentic.widget.v1.WidgetPreferences",
			ProtoFile: "apis/ai/stigmer/agentic/widget/v1/spec.proto",
			Fields: []*FieldSchema{
				field("StandingContext", "standingContext", "standing_context", TypeSpec{Kind: "string"}),
			},
		},
	}

	var buf bytes.Buffer
	imports := newTSImportSet()
	generateTSUpdateInputMapper(&buf, schema, cfg, spec, typeMap, imports)
	got := buf.String()

	mustContain(t, got, "export function toWidgetUpdateInput(resource: Widget): WidgetInput {")
	mustContain(t, got, "const spec = resource.spec ?? create(WidgetSpecSchema);")
	mustContain(t, got, `name: meta?.name ?? "",`)
	mustContain(t, got, "slug: meta?.slug || undefined,")
	mustContain(t, got, `org: meta?.org ?? "",`)
	mustContain(t, got, "labels: meta?.labels && Object.keys(meta.labels).length > 0 ? { ...meta.labels } : undefined,")
	mustContain(t, got, "visibility: meta?.visibility || undefined,")
	mustContain(t, got, "versionMessage: undefined,")
	mustContain(t, got, "description: spec.description || undefined,")
	mustContain(t, got, "preferences: spec.preferences ? toWidgetPreferencesInput(spec.preferences) : undefined,")
	// Nested helper is emitted (complete at every level — the nested wipe rule).
	mustContain(t, got, "function toWidgetPreferencesInput(msg: WidgetPreferences): WidgetPreferencesInput {")
	mustContain(t, got, "standingContext: msg.standingContext || undefined,")

	// Non-versioned kinds must not emit versionMessage at all.
	cfg.isVersioned = false
	buf.Reset()
	generateTSUpdateInputMapper(&buf, schema, cfg, spec, typeMap, newTSImportSet())
	mustNotContain(t, buf.String(), "versionMessage")
}

func TestGenerateTSUpdateInputMapperOrganizationOrgFallback(t *testing.T) {
	schema := &ServiceSchemaFile{
		Resource: "organization",
		Package:  "ai.stigmer.tenancy.organization.v1",
		Services: []ServiceDefinition{{
			Role:    "command",
			Methods: []MethodSchema{{Name: "Update", InputType: "Organization"}},
		}},
	}
	cfg := sdkResourceConfig{protoResType: "Organization", inputPrefix: "Organization"}
	spec := &TaskConfigSchema{
		Name:   "OrganizationSpec",
		Fields: []*FieldSchema{field("Description", "description", "description", TypeSpec{Kind: "string"})},
	}

	var buf bytes.Buffer
	generateTSUpdateInputMapper(&buf, schema, cfg, spec, map[string]*TypeSchema{}, newTSImportSet())
	mustContain(t, buf.String(), `org: meta?.org || meta?.slug || "",`)
}
