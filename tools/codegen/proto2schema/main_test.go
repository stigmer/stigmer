package main

import (
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

func TestStripInternalSection(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"no marker passes through trimmed",
			"  Resource slug (unique within org).\n Format: lowercase alphanumeric.  ",
			"Resource slug (unique within org).\n Format: lowercase alphanumeric.",
		},
		{
			"marker mid-text keeps only the SDK-facing prefix",
			"When true the value is treated as a secret.\n\n@internal\nWhen is_secret is true the value is encrypted at rest.",
			"When true the value is treated as a secret.",
		},
		{
			"marker on the first line yields empty",
			"@internal\nAuthorization: requires can_edit on the resource.",
			"",
		},
		{
			"whitespace-padded marker line still counts",
			"Public text.\n   @internal   \nHandler strategy notes.",
			"Public text.",
		},
		{
			"multi-paragraph SDK prefix is preserved byte-for-byte",
			"First paragraph.\n\nSecond paragraph with detail.\n\n@internal\nInternal only.",
			"First paragraph.\n\nSecond paragraph with detail.",
		},
		{
			"truncates at the first of several markers",
			"Public.\n@internal\nInternal one.\n@internal\nInternal two.",
			"Public.",
		},
		{
			"inline @internal inside prose is not a marker",
			"See the @internal tag convention for details.",
			"See the @internal tag convention for details.",
		},
		{
			"line with trailing text after @internal is not a marker",
			"Public text.\n@internal note that stays\nMore public text.",
			"Public text.\n@internal note that stays\nMore public text.",
		},
		{
			"marker only yields empty",
			"@internal",
			"",
		},
		{
			"empty input",
			"",
			"",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := stripInternalSection(tc.input)
			if got != tc.expected {
				t.Errorf("stripInternalSection(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestExtractTaskKind(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple single word", "SetTaskConfig", "SET"},
		{"two word camelCase", "HttpCallTaskConfig", "HTTP_CALL"},
		{"three word camelCase", "SendEmailNotificationTaskConfig", "SEND_EMAIL_NOTIFICATION"},
		{"already uppercase acronym", "AITaskConfig", "A_I"},
		{"no suffix match", "FooBar", "FOO_BAR"},
		{"suffix only", "TaskConfig", ""},
		{"empty string", "", ""},
		{"single char", "ATaskConfig", "A"},
		{"lowercase only", "setTaskConfig", "SET"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractTaskKind(tc.input)
			if got != tc.expected {
				t.Errorf("extractTaskKind(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestToCamelCase(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		capitalizeFirst bool
		expected        string
	}{
		{"simple snake_case capitalize", "hello_world", true, "HelloWorld"},
		{"simple snake_case no capitalize", "hello_world", false, "helloWorld"},
		{"single word capitalize", "hello", true, "Hello"},
		{"single word no capitalize", "hello", false, "hello"},
		{"three parts capitalize", "one_two_three", true, "OneTwoThree"},
		{"three parts no capitalize", "one_two_three", false, "oneTwoThree"},
		{"empty string", "", true, ""},
		{"trailing underscore", "foo_", true, "Foo"},
		{"leading underscore", "_foo", true, "Foo"},
		{"double underscore", "foo__bar", true, "FooBar"},
		{"already lowercase single", "a", true, "A"},
		{"already lowercase single no cap", "a", false, "a"},
		{"mixed case parts", "FOO_BAR", true, "FooBar"},
		{"mixed case parts no cap (first part untouched)", "FOO_BAR", false, "FOOBar"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := toCamelCase(tc.input, tc.capitalizeFirst)
			if got != tc.expected {
				t.Errorf("toCamelCase(%q, %v) = %q, want %q", tc.input, tc.capitalizeFirst, got, tc.expected)
			}
		})
	}
}

func TestDeriveGoImportAlias(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"standard agentic package", "ai.stigmer.agentic.agent.v1", "agentv1"},
		{"iam package", "ai.stigmer.iam.apikey.v1", "apikeyv1"},
		{"tenancy package", "ai.stigmer.tenancy.org.v1", "orgv1"},
		{"two parts only", "session.v1", "sessionv1"},
		{"single part", "agent", "agent"},
		{"deeply nested", "a.b.c.d.e.f", "ef"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveGoImportAlias(tc.input)
			if got != tc.expected {
				t.Errorf("deriveGoImportAlias(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestInferServiceRole(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"command controller", "AgentCommandController", "command"},
		{"query controller", "AgentQueryController", "query"},
		{"lowercase command", "agentcommandcontroller", "command"},
		{"lowercase query", "agentquerycontroller", "query"},
		{"token controller", "PlatformClientTokenController", "token"},
		{"lowercase token", "platformclienttokencontroller", "token"},
		{"neither defaults to query", "AgentService", "query"},
		{"empty string", "", "query"},
		{"command takes precedence over query", "CommandQueryService", "command"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := inferServiceRole(tc.input)
			if got != tc.expected {
				t.Errorf("inferServiceRole(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestCapitalize(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"lowercase word", "hello", "Hello"},
		{"already capitalized", "Hello", "Hello"},
		{"single char", "a", "A"},
		{"empty string", "", ""},
		{"number prefix", "123abc", "123abc"},
		{"all caps", "ABC", "ABC"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := capitalize(tc.input)
			if got != tc.expected {
				t.Errorf("capitalize(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestCountMethods(t *testing.T) {
	tests := []struct {
		name     string
		schema   *ServiceSchemaFile
		expected int
	}{
		{
			"nil services",
			&ServiceSchemaFile{},
			0,
		},
		{
			"single service single method",
			&ServiceSchemaFile{
				Services: []ServiceDefinition{
					{Methods: []MethodSchema{{Name: "Create"}}},
				},
			},
			1,
		},
		{
			"multiple services multiple methods",
			&ServiceSchemaFile{
				Services: []ServiceDefinition{
					{Methods: []MethodSchema{{Name: "Create"}, {Name: "Update"}}},
					{Methods: []MethodSchema{{Name: "Get"}, {Name: "List"}, {Name: "Delete"}}},
				},
			},
			5,
		},
		{
			"service with no methods",
			&ServiceSchemaFile{
				Services: []ServiceDefinition{
					{Methods: []MethodSchema{}},
					{Methods: []MethodSchema{{Name: "Get"}}},
				},
			},
			1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := countMethods(tc.schema)
			if got != tc.expected {
				t.Errorf("countMethods() = %d, want %d", got, tc.expected)
			}
		})
	}
}

func TestExtractStringFromUnknownFields(t *testing.T) {
	buildBytesField := func(fieldNum protowire.Number, value string) []byte {
		var buf []byte
		buf = protowire.AppendTag(buf, fieldNum, protowire.BytesType)
		buf = protowire.AppendString(buf, value)
		return buf
	}

	buildVarintField := func(fieldNum protowire.Number, value uint64) []byte {
		var buf []byte
		buf = protowire.AppendTag(buf, fieldNum, protowire.VarintType)
		buf = protowire.AppendVarint(buf, value)
		return buf
	}

	tests := []struct {
		name        string
		raw         []byte
		targetField protowire.Number
		expected    string
	}{
		{
			"exact field match",
			buildBytesField(90301, "MY_VALUE"),
			90301,
			"MY_VALUE",
		},
		{
			"field not present",
			buildBytesField(90301, "MY_VALUE"),
			90302,
			"",
		},
		{
			"empty raw bytes",
			nil,
			90301,
			"",
		},
		{
			"target after other fields",
			append(buildVarintField(1, 42), buildBytesField(90205, "discriminator_field")...),
			90205,
			"discriminator_field",
		},
		{
			"multiple bytes fields picks correct one",
			append(buildBytesField(100, "wrong"), buildBytesField(200, "right")...),
			200,
			"right",
		},
		{
			"empty string value",
			buildBytesField(90301, ""),
			90301,
			"",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractStringFromUnknownFields(tc.raw, tc.targetField)
			if got != tc.expected {
				t.Errorf("extractStringFromUnknownFields(targetField=%d) = %q, want %q", tc.targetField, got, tc.expected)
			}
		})
	}
}

func TestAssignServiceRoles(t *testing.T) {
	const dir = "ai/stigmer/agentic/example/v1/"

	tests := []struct {
		name     string
		services []serviceRoleInput
		expected map[string]string
	}{
		{
			"primary controllers keep bare roles",
			[]serviceRoleInput{
				{"AgentChannelCommandController", dir + "command.proto"},
				{"AgentChannelQueryController", dir + "query.proto"},
			},
			map[string]string{
				"AgentChannelCommandController": "command",
				"AgentChannelQueryController":   "query",
			},
		},
		{
			// The motivating case: message_query.proto sorts before
			// query.proto, but the bare "query" role must stay with the
			// service defined in query.proto.
			"added services never rename existing roles",
			[]serviceRoleInput{
				{"AgentChannelCommandController", dir + "command.proto"},
				{"ChannelMessageCommandController", dir + "message_command.proto"},
				{"ChannelMessageQueryController", dir + "message_query.proto"},
				{"AgentChannelQueryController", dir + "query.proto"},
			},
			map[string]string{
				"AgentChannelCommandController":   "command",
				"AgentChannelQueryController":     "query",
				"ChannelMessageCommandController": "channelMessageCommand",
				"ChannelMessageQueryController":   "channelMessageQuery",
			},
		},
		{
			"token role is uncontested",
			[]serviceRoleInput{
				{"PlatformClientCommandController", dir + "command.proto"},
				{"PlatformClientQueryController", dir + "query.proto"},
				{"PlatformClientTokenController", dir + "token.proto"},
			},
			map[string]string{
				"PlatformClientCommandController": "command",
				"PlatformClientQueryController":   "query",
				"PlatformClientTokenController":   "token",
			},
		},
		{
			"role-keyword-free name in query.proto keeps the query role",
			[]serviceRoleInput{
				{"SearchService", dir + "query.proto"},
			},
			map[string]string{
				"SearchService": "query",
			},
		},
		{
			"single claimant keeps bare role regardless of file name",
			[]serviceRoleInput{
				{"FooQueryController", dir + "foo_query.proto"},
			},
			map[string]string{
				"FooQueryController": "query",
			},
		},
		{
			"collision with no role-named file yields unique roles for all",
			[]serviceRoleInput{
				{"BarQueryController", dir + "bar_query.proto"},
				{"FooQueryController", dir + "foo_query.proto"},
			},
			map[string]string{
				"BarQueryController": "barQuery",
				"FooQueryController": "fooQuery",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Roles are field names on the generated SDK clients, so the
			// assignment must be identical under every discovery order.
			permuteServiceRoleInputs(tc.services, func(perm []serviceRoleInput) {
				got := assignServiceRoles(perm)
				if len(got) != len(tc.expected) {
					t.Fatalf("assignServiceRoles(%v) returned %d roles, want %d", perm, len(got), len(tc.expected))
				}
				for svc, wantRole := range tc.expected {
					if got[svc] != wantRole {
						t.Errorf("assignServiceRoles(order %v): role for %s = %q, want %q", perm, svc, got[svc], wantRole)
					}
				}
			})
		})
	}
}

// permuteServiceRoleInputs invokes fn with every permutation of services
// (Heap's algorithm; the test inputs are small).
func permuteServiceRoleInputs(services []serviceRoleInput, fn func([]serviceRoleInput)) {
	perm := make([]serviceRoleInput, len(services))
	copy(perm, services)

	var generate func(k int)
	generate = func(k int) {
		if k <= 1 {
			fn(perm)
			return
		}
		for i := 0; i < k; i++ {
			generate(k - 1)
			if k%2 == 0 {
				perm[i], perm[k-1] = perm[k-1], perm[i]
			} else {
				perm[0], perm[k-1] = perm[k-1], perm[0]
			}
		}
	}
	generate(len(perm))
}
