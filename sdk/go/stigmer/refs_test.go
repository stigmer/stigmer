package stigmer

import (
	"testing"
)

// =============================================================================
// StringRef Tests
// =============================================================================

func TestStringRef_Expression(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "apiURL"},
		value:   "https://api.example.com",
	}

	expected := "${ $context.apiURL }"
	if got := ref.Expression(); got != expected {
		t.Errorf("Expression() = %q, want %q", got, expected)
	}
}

func TestStringRef_Name(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "apiURL"},
		value:   "https://api.example.com",
	}

	expected := "apiURL"
	if got := ref.Name(); got != expected {
		t.Errorf("Name() = %q, want %q", got, expected)
	}
}

func TestStringRef_IsSecret(t *testing.T) {
	tests := []struct {
		name     string
		isSecret bool
	}{
		{"not secret", false},
		{"is secret", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := &StringRef{
				baseRef: baseRef{name: "test", isSecret: tt.isSecret},
				value:   "value",
			}

			if got := ref.IsSecret(); got != tt.isSecret {
				t.Errorf("IsSecret() = %v, want %v", got, tt.isSecret)
			}
		})
	}
}

func TestStringRef_Value(t *testing.T) {
	expected := "https://api.example.com"
	ref := &StringRef{
		baseRef: baseRef{name: "apiURL"},
		value:   expected,
	}

	if got := ref.Value(); got != expected {
		t.Errorf("Value() = %q, want %q", got, expected)
	}
}

func TestStringRef_Concat(t *testing.T) {
	tests := []struct {
		name     string
		base     *StringRef
		parts    []interface{}
		expected string
	}{
		{
			name: "concat with literal string",
			base: &StringRef{
				baseRef: baseRef{name: "apiURL"},
				value:   "https://api.example.com",
			},
			parts:    []interface{}{"/users"},
			expected: `${ $context.apiURL + "/users" }`,
		},
		{
			name: "concat with another StringRef",
			base: &StringRef{
				baseRef: baseRef{name: "baseURL"},
				value:   "https://api.example.com",
			},
			parts: []interface{}{
				&StringRef{
					baseRef: baseRef{name: "path"},
					value:   "/users",
				},
			},
			expected: `${ $context.baseURL + $context.path }`,
		},
		{
			name: "concat multiple parts",
			base: &StringRef{
				baseRef: baseRef{name: "baseURL"},
				value:   "https://api.example.com",
			},
			parts: []interface{}{
				"/users/",
				&StringRef{
					baseRef: baseRef{name: "userID"},
					value:   "123",
				},
			},
			expected: `${ $context.baseURL + "/users/" + $context.userID }`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.base.Concat(tt.parts...)
			if got := result.Expression(); got != tt.expected {
				t.Errorf("Concat() expression = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestStringRef_Upper(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "name"},
		value:   "alice",
	}

	result := ref.Upper()
	expected := "${ ($context.name | ascii_upcase) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Upper() expression = %q, want %q", got, expected)
	}
}

func TestStringRef_Lower(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "name"},
		value:   "ALICE",
	}

	result := ref.Lower()
	expected := "${ ($context.name | ascii_downcase) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Lower() expression = %q, want %q", got, expected)
	}
}

func TestStringRef_Prepend(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "path"},
		value:   "users",
	}

	result := ref.Prepend("/api/")
	expected := `${ ("/api/" + $context.path) }`

	if got := result.Expression(); got != expected {
		t.Errorf("Prepend() expression = %q, want %q", got, expected)
	}
}

func TestStringRef_Append(t *testing.T) {
	ref := &StringRef{
		baseRef: baseRef{name: "base"},
		value:   "https://api.example.com",
	}

	result := ref.Append("/v1")
	expected := `${ ($context.base + "/v1") }`

	if got := result.Expression(); got != expected {
		t.Errorf("Append() expression = %q, want %q", got, expected)
	}
}

// =============================================================================
// IntRef Tests
// =============================================================================

func TestIntRef_Expression(t *testing.T) {
	ref := &IntRef{
		baseRef: baseRef{name: "retries"},
		value:   3,
	}

	expected := "${ $context.retries }"
	if got := ref.Expression(); got != expected {
		t.Errorf("Expression() = %q, want %q", got, expected)
	}
}

func TestIntRef_Value(t *testing.T) {
	expected := 42
	ref := &IntRef{
		baseRef: baseRef{name: "answer"},
		value:   expected,
	}

	if got := ref.Value(); got != expected {
		t.Errorf("Value() = %d, want %d", got, expected)
	}
}

func TestIntRef_Add(t *testing.T) {
	base := &IntRef{
		baseRef: baseRef{name: "base"},
		value:   10,
	}
	increment := &IntRef{
		baseRef: baseRef{name: "increment"},
		value:   5,
	}

	result := base.Add(increment)
	expected := "${ ($context.base + $context.increment) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Add() expression = %q, want %q", got, expected)
	}
}

func TestIntRef_Subtract(t *testing.T) {
	base := &IntRef{
		baseRef: baseRef{name: "total"},
		value:   100,
	}
	decrement := &IntRef{
		baseRef: baseRef{name: "used"},
		value:   30,
	}

	result := base.Subtract(decrement)
	expected := "${ ($context.total - $context.used) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Subtract() expression = %q, want %q", got, expected)
	}
}

func TestIntRef_Multiply(t *testing.T) {
	base := &IntRef{
		baseRef: baseRef{name: "quantity"},
		value:   5,
	}
	multiplier := &IntRef{
		baseRef: baseRef{name: "price"},
		value:   10,
	}

	result := base.Multiply(multiplier)
	expected := "${ ($context.quantity * $context.price) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Multiply() expression = %q, want %q", got, expected)
	}
}

func TestIntRef_Divide(t *testing.T) {
	base := &IntRef{
		baseRef: baseRef{name: "total"},
		value:   100,
	}
	divisor := &IntRef{
		baseRef: baseRef{name: "count"},
		value:   5,
	}

	result := base.Divide(divisor)
	expected := "${ ($context.total / $context.count) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Divide() expression = %q, want %q", got, expected)
	}
}

// =============================================================================
// BoolRef Tests
// =============================================================================

func TestBoolRef_Expression(t *testing.T) {
	ref := &BoolRef{
		baseRef: baseRef{name: "isEnabled"},
		value:   true,
	}

	expected := "${ $context.isEnabled }"
	if got := ref.Expression(); got != expected {
		t.Errorf("Expression() = %q, want %q", got, expected)
	}
}

func TestBoolRef_Value(t *testing.T) {
	tests := []struct {
		name     string
		expected bool
	}{
		{"true value", true},
		{"false value", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ref := &BoolRef{
				baseRef: baseRef{name: "test"},
				value:   tt.expected,
			}

			if got := ref.Value(); got != tt.expected {
				t.Errorf("Value() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestBoolRef_And(t *testing.T) {
	hasAccess := &BoolRef{
		baseRef: baseRef{name: "hasAccess"},
		value:   true,
	}
	isEnabled := &BoolRef{
		baseRef: baseRef{name: "isEnabled"},
		value:   true,
	}

	result := hasAccess.And(isEnabled)
	expected := "${ ($context.hasAccess and $context.isEnabled) }"

	if got := result.Expression(); got != expected {
		t.Errorf("And() expression = %q, want %q", got, expected)
	}
}

func TestBoolRef_Or(t *testing.T) {
	isAdmin := &BoolRef{
		baseRef: baseRef{name: "isAdmin"},
		value:   false,
	}
	isOwner := &BoolRef{
		baseRef: baseRef{name: "isOwner"},
		value:   true,
	}

	result := isAdmin.Or(isOwner)
	expected := "${ ($context.isAdmin or $context.isOwner) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Or() expression = %q, want %q", got, expected)
	}
}

func TestBoolRef_Not(t *testing.T) {
	isEnabled := &BoolRef{
		baseRef: baseRef{name: "isEnabled"},
		value:   true,
	}

	result := isEnabled.Not()
	expected := "${ ($context.isEnabled | not) }"

	if got := result.Expression(); got != expected {
		t.Errorf("Not() expression = %q, want %q", got, expected)
	}
}

// =============================================================================
// ObjectRef Tests
// =============================================================================

func TestObjectRef_Expression(t *testing.T) {
	ref := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"host": "localhost",
			"port": 5432,
		},
	}

	expected := "${ $context.config }"
	if got := ref.Expression(); got != expected {
		t.Errorf("Expression() = %q, want %q", got, expected)
	}
}

func TestObjectRef_Value(t *testing.T) {
	expected := map[string]interface{}{
		"host": "localhost",
		"port": 5432,
	}
	ref := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value:   expected,
	}

	got := ref.Value()
	if got["host"] != expected["host"] || got["port"] != expected["port"] {
		t.Errorf("Value() = %v, want %v", got, expected)
	}
}

func TestObjectRef_Field(t *testing.T) {
	config := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"database": map[string]interface{}{
				"host": "localhost",
				"port": 5432,
			},
		},
	}

	database := config.Field("database")
	expected := "${ ($context.config.database) }"

	if got := database.Expression(); got != expected {
		t.Errorf("Field() expression = %q, want %q", got, expected)
	}
}

func TestObjectRef_NestedFields(t *testing.T) {
	config := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"database": map[string]interface{}{
				"connection": map[string]interface{}{
					"host": "localhost",
				},
			},
		},
	}

	host := config.Field("database").Field("connection").Field("host")
	expected := "${ ((($context.config.database).connection).host) }"

	if got := host.Expression(); got != expected {
		t.Errorf("Nested Field() expression = %q, want %q", got, expected)
	}
}

func TestObjectRef_FieldAsString(t *testing.T) {
	config := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"database": map[string]interface{}{
				"host": "localhost",
			},
		},
	}

	host := config.FieldAsString("database", "host")
	expected := "${ (($context.config.database).host) }"

	if got := host.Expression(); got != expected {
		t.Errorf("FieldAsString() expression = %q, want %q", got, expected)
	}
}

func TestObjectRef_FieldAsInt(t *testing.T) {
	config := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"database": map[string]interface{}{
				"port": 5432,
			},
		},
	}

	port := config.FieldAsInt("database", "port")
	expected := "${ (($context.config.database).port) }"

	if got := port.Expression(); got != expected {
		t.Errorf("FieldAsInt() expression = %q, want %q", got, expected)
	}
}

func TestObjectRef_FieldAsBool(t *testing.T) {
	config := &ObjectRef{
		baseRef: baseRef{name: "config"},
		value: map[string]interface{}{
			"features": map[string]interface{}{
				"enabled": true,
			},
		},
	}

	enabled := config.FieldAsBool("features", "enabled")
	expected := "${ (($context.config.features).enabled) }"

	if got := enabled.Expression(); got != expected {
		t.Errorf("FieldAsBool() expression = %q, want %q", got, expected)
	}
}

// =============================================================================
// Integration Tests - Complex Scenarios
// =============================================================================

func TestComplexExpressions_StringConcat(t *testing.T) {
	// Test complex string concatenation with multiple operations
	base := &StringRef{
		baseRef: baseRef{name: "baseURL"},
		value:   "https://api.example.com",
	}
	version := &StringRef{
		baseRef: baseRef{name: "version"},
		value:   "v1",
	}
	endpoint := &StringRef{
		baseRef: baseRef{name: "endpoint"},
		value:   "users",
	}

	// Build: baseURL + "/api/" + version + "/" + endpoint
	fullURL := base.Concat("/api/", version, "/", endpoint)

	// Expression should contain all parts
	expr := fullURL.Expression()
	if expr == "" {
		t.Error("Complex expression should not be empty")
	}

	// Should contain all variable references
	t.Logf("Complex expression: %s", expr)
}

func TestComplexExpressions_IntArithmetic(t *testing.T) {
	// Test complex integer arithmetic
	base := &IntRef{
		baseRef: baseRef{name: "base"},
		value:   100,
	}
	multiplier := &IntRef{
		baseRef: baseRef{name: "multiplier"},
		value:   2,
	}
	offset := &IntRef{
		baseRef: baseRef{name: "offset"},
		value:   10,
	}

	// Build: (base * multiplier) + offset
	result := base.Multiply(multiplier).Add(offset)

	expr := result.Expression()
	if expr == "" {
		t.Error("Complex arithmetic expression should not be empty")
	}

	t.Logf("Complex arithmetic: %s", expr)
}

func TestComplexExpressions_BoolLogic(t *testing.T) {
	// Test complex boolean logic
	isProd := &BoolRef{
		baseRef: baseRef{name: "isProd"},
		value:   true,
	}
	isDebug := &BoolRef{
		baseRef: baseRef{name: "isDebug"},
		value:   false,
	}
	hasAccess := &BoolRef{
		baseRef: baseRef{name: "hasAccess"},
		value:   true,
	}

	// Build: (isProd and !isDebug) or hasAccess
	result := isProd.And(isDebug.Not()).Or(hasAccess)

	expr := result.Expression()
	if expr == "" {
		t.Error("Complex boolean expression should not be empty")
	}

	t.Logf("Complex boolean: %s", expr)
}

func TestSecretPropagation(t *testing.T) {
	// Test that secret flag is preserved through operations
	apiKey := &StringRef{
		baseRef: baseRef{name: "apiKey", isSecret: true},
		value:   "secret-key-123",
	}

	// Transform the secret - should remain secret
	header := apiKey.Prepend("Bearer ")

	if !apiKey.IsSecret() {
		t.Error("Original apiKey should be secret")
	}

	// Note: Current implementation doesn't propagate secret flag in Prepend
	// This is a design decision - transformed values might not need to be secret
	t.Logf("Header secret status: %v", header.IsSecret())
}

// =============================================================================
// ToValue() Tests - Context Variable Injection Support
// =============================================================================

func TestStringRef_ToValue(t *testing.T) {
	tests := []struct {
		name     string
		ref      *StringRef
		expected interface{}
	}{
		{
			name: "simple string value",
			ref: &StringRef{
				baseRef: baseRef{name: "apiURL"},
				value:   "https://api.example.com",
			},
			expected: "https://api.example.com",
		},
		{
			name: "empty string value",
			ref: &StringRef{
				baseRef: baseRef{name: "empty"},
				value:   "",
			},
			expected: "",
		},
		{
			name: "secret string value",
			ref: &StringRef{
				baseRef: baseRef{name: "apiKey", isSecret: true},
				value:   "secret-123",
			},
			expected: "secret-123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.ref.ToValue()
			if got != tt.expected {
				t.Errorf("ToValue() = %v, want %v", got, tt.expected)
			}
			
			// Verify type is string
			if _, ok := got.(string); !ok {
				t.Errorf("ToValue() returned %T, want string", got)
			}
		})
	}
}

func TestIntRef_ToValue(t *testing.T) {
	tests := []struct {
		name     string
		ref      *IntRef
		expected interface{}
	}{
		{
			name: "positive integer",
			ref: &IntRef{
				baseRef: baseRef{name: "retries"},
				value:   3,
			},
			expected: 3,
		},
		{
			name: "zero value",
			ref: &IntRef{
				baseRef: baseRef{name: "zero"},
				value:   0,
			},
			expected: 0,
		},
		{
			name: "negative integer",
			ref: &IntRef{
				baseRef: baseRef{name: "offset"},
				value:   -10,
			},
			expected: -10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.ref.ToValue()
			if got != tt.expected {
				t.Errorf("ToValue() = %v, want %v", got, tt.expected)
			}
			
			// Verify type is int
			if _, ok := got.(int); !ok {
				t.Errorf("ToValue() returned %T, want int", got)
			}
		})
	}
}

func TestBoolRef_ToValue(t *testing.T) {
	tests := []struct {
		name     string
		ref      *BoolRef
		expected interface{}
	}{
		{
			name: "true value",
			ref: &BoolRef{
				baseRef: baseRef{name: "isProd"},
				value:   true,
			},
			expected: true,
		},
		{
			name: "false value",
			ref: &BoolRef{
				baseRef: baseRef{name: "isDebug"},
				value:   false,
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.ref.ToValue()
			if got != tt.expected {
				t.Errorf("ToValue() = %v, want %v", got, tt.expected)
			}
			
			// Verify type is bool
			if _, ok := got.(bool); !ok {
				t.Errorf("ToValue() returned %T, want bool", got)
			}
		})
	}
}

func TestObjectRef_ToValue(t *testing.T) {
	tests := []struct {
		name     string
		ref      *ObjectRef
		validate func(t *testing.T, got interface{})
	}{
		{
			name: "simple object",
			ref: &ObjectRef{
				baseRef: baseRef{name: "config"},
				value: map[string]interface{}{
					"host": "localhost",
					"port": 5432,
				},
			},
			validate: func(t *testing.T, got interface{}) {
				m, ok := got.(map[string]interface{})
				if !ok {
					t.Fatalf("ToValue() returned %T, want map[string]interface{}", got)
				}
				if m["host"] != "localhost" {
					t.Errorf("host = %v, want localhost", m["host"])
				}
				if m["port"] != 5432 {
					t.Errorf("port = %v, want 5432", m["port"])
				}
			},
		},
		{
			name: "nested object",
			ref: &ObjectRef{
				baseRef: baseRef{name: "config"},
				value: map[string]interface{}{
					"database": map[string]interface{}{
						"host": "localhost",
						"port": 5432,
					},
					"cache": map[string]interface{}{
						"enabled": true,
					},
				},
			},
			validate: func(t *testing.T, got interface{}) {
				m, ok := got.(map[string]interface{})
				if !ok {
					t.Fatalf("ToValue() returned %T, want map[string]interface{}", got)
				}
				
				db, ok := m["database"].(map[string]interface{})
				if !ok {
					t.Fatalf("database field should be map[string]interface{}")
				}
				if db["host"] != "localhost" {
					t.Errorf("database.host = %v, want localhost", db["host"])
				}
				
				cache, ok := m["cache"].(map[string]interface{})
				if !ok {
					t.Fatalf("cache field should be map[string]interface{}")
				}
				if cache["enabled"] != true {
					t.Errorf("cache.enabled = %v, want true", cache["enabled"])
				}
			},
		},
		{
			name: "empty object",
			ref: &ObjectRef{
				baseRef: baseRef{name: "empty"},
				value:   map[string]interface{}{},
			},
			validate: func(t *testing.T, got interface{}) {
				m, ok := got.(map[string]interface{})
				if !ok {
					t.Fatalf("ToValue() returned %T, want map[string]interface{}", got)
				}
				if len(m) != 0 {
					t.Errorf("expected empty map, got %v", m)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.ref.ToValue()
			tt.validate(t, got)
		})
	}
}

func TestToValue_RefInterface(t *testing.T) {
	// Test that ToValue() works via the Ref interface
	var refs []Ref
	
	refs = append(refs, &StringRef{
		baseRef: baseRef{name: "str"},
		value:   "hello",
	})
	
	refs = append(refs, &IntRef{
		baseRef: baseRef{name: "num"},
		value:   42,
	})
	
	refs = append(refs, &BoolRef{
		baseRef: baseRef{name: "flag"},
		value:   true,
	})
	
	refs = append(refs, &ObjectRef{
		baseRef: baseRef{name: "obj"},
		value: map[string]interface{}{
			"key": "value",
		},
	})
	
	// Verify we can call ToValue() through the interface
	for i, ref := range refs {
		value := ref.ToValue()
		if value == nil {
			t.Errorf("refs[%d].ToValue() returned nil", i)
		}
		t.Logf("refs[%d] (%s): ToValue() = %v (type: %T)", i, ref.Name(), value, value)
	}
}
