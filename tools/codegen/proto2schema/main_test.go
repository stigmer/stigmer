package main

import (
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

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
