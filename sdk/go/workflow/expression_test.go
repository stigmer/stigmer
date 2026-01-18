package workflow

import (
	"testing"
)

// TestVarRef tests that VarRef generates correct $context expressions
func TestVarRef(t *testing.T) {
	tests := []struct {
		name     string
		varName  string
		expected string
	}{
		{
			name:     "simple variable",
			varName:  "apiURL",
			expected: "${ $context.apiURL }",
		},
		{
			name:     "counter variable",
			varName:  "retryCount",
			expected: "${ $context.retryCount }",
		},
		{
			name:     "status variable",
			varName:  "status",
			expected: "${ $context.status }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := VarRef(tt.varName)
			if result != tt.expected {
				t.Errorf("VarRef(%q) = %q, want %q", tt.varName, result, tt.expected)
			}
		})
	}
}

// TestFieldRef tests that FieldRef generates correct $context expressions
func TestFieldRef(t *testing.T) {
	tests := []struct {
		name      string
		fieldPath string
		expected  string
	}{
		{
			name:      "simple field",
			fieldPath: "count",
			expected:  "${ $context.count }",
		},
		{
			name:      "nested field",
			fieldPath: "user.name",
			expected:  "${ $context.user.name }",
		},
		{
			name:      "deep nested field",
			fieldPath:  "response.data.items[0].id",
			expected:  "${ $context.response.data.items[0].id }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := FieldRef(tt.fieldPath)
			if result != tt.expected {
				t.Errorf("FieldRef(%q) = %q, want %q", tt.fieldPath, result, tt.expected)
			}
		})
	}
}

// TestInterpolate tests string interpolation with VarRef
func TestInterpolate(t *testing.T) {
	tests := []struct {
		name     string
		parts    []string
		expected string
	}{
		{
			name:     "single variable reference",
			parts:    []string{VarRef("apiURL")},
			expected: "${ $context.apiURL }",
		},
		{
			name:     "variable with path suffix",
			parts:    []string{VarRef("apiURL"), "/posts/1"},
			expected: "${ $context.apiURL + \"/posts/1\" }",
		},
		{
			name:     "prefix with variable",
			parts:    []string{"Bearer ", VarRef("token")},
			expected: "${ \"Bearer \" + $context.token }",
		},
		{
			name:     "multiple parts",
			parts:    []string{"https://", VarRef("domain"), "/api/v1"},
			expected: "${ \"https://\" + $context.domain + \"/api/v1\" }",
		},
		{
			name:     "plain string only",
			parts:    []string{"https://api.example.com"},
			expected: "https://api.example.com",
		},
		{
			name:     "multiple plain strings",
			parts:    []string{"https://", "api.example.com", "/data"},
			expected: "https://api.example.com/data",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Interpolate(tt.parts...)
			if result != tt.expected {
				t.Errorf("Interpolate(%v) = %q, want %q", tt.parts, result, tt.expected)
			}
		})
	}
}

// TestIncrement tests increment expression generation
func TestIncrement(t *testing.T) {
	tests := []struct {
		name     string
		varName  string
		expected string
	}{
		{
			name:     "retry counter",
			varName:  "retryCount",
			expected: "${ $context.retryCount + 1 }",
		},
		{
			name:     "iteration counter",
			varName:  "iteration",
			expected: "${ $context.iteration + 1 }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Increment(tt.varName)
			if result != tt.expected {
				t.Errorf("Increment(%q) = %q, want %q", tt.varName, result, tt.expected)
			}
		})
	}
}

// TestDecrement tests decrement expression generation
func TestDecrement(t *testing.T) {
	tests := []struct {
		name     string
		varName  string
		expected string
	}{
		{
			name:     "remaining items",
			varName:  "remaining",
			expected: "${ $context.remaining - 1 }",
		},
		{
			name:     "countdown timer",
			varName:  "countdown",
			expected: "${ $context.countdown - 1 }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Decrement(tt.varName)
			if result != tt.expected {
				t.Errorf("Decrement(%q) = %q, want %q", tt.varName, result, tt.expected)
			}
		})
	}
}

// TestExpr tests custom expression generation
func TestExpr(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		expected   string
	}{
		{
			name:       "arithmetic with context variables",
			expression: "($context.price * $context.quantity) + $context.tax",
			expected:   "${ ($context.price * $context.quantity) + $context.tax }",
		},
		{
			name:       "string concatenation",
			expression: "$context.firstName + ' ' + $context.lastName",
			expected:   "${ $context.firstName + ' ' + $context.lastName }",
		},
		{
			name:       "field access",
			expression: ".response.status",
			expected:   "${ .response.status }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Expr(tt.expression)
			if result != tt.expected {
				t.Errorf("Expr(%q) = %q, want %q", tt.expression, result, tt.expected)
			}
		})
	}
}

// TestErrorHelpers tests error field accessor functions
func TestErrorHelpers(t *testing.T) {
	tests := []struct {
		name     string
		errorVar string
		fn       func(string) string
		expected string
	}{
		{
			name:     "error message",
			errorVar: "httpErr",
			fn:       ErrorMessage,
			expected: "${ .httpErr.message }",
		},
		{
			name:     "error code",
			errorVar: "err",
			fn:       ErrorCode,
			expected: "${ .err.code }",
		},
		{
			name:     "error stack trace",
			errorVar: "err",
			fn:       ErrorStackTrace,
			expected: "${ .err.stackTrace }",
		},
		{
			name:     "error object",
			errorVar: "err",
			fn:       ErrorObject,
			expected: "${ .err }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.fn(tt.errorVar)
			if result != tt.expected {
				t.Errorf("%s(%q) = %q, want %q", tt.name, tt.errorVar, result, tt.expected)
			}
		})
	}
}

// TestConditionBuilders tests condition expression builders
func TestConditionBuilders(t *testing.T) {
	tests := []struct {
		name     string
		build    func() string
		expected string
	}{
		{
			name: "field equals number",
			build: func() string {
				return Equals(Field("status"), Number(200))
			},
			expected: "${ .status == 200 }",
		},
		{
			name: "context var equals literal",
			build: func() string {
				return Equals(Var("apiURL"), Literal("https://api.example.com"))
			},
			expected: "${ $context.apiURL == \"https://api.example.com\" }",
		},
		{
			name: "field not equals number",
			build: func() string {
				return NotEquals(Field("status"), Number(404))
			},
			expected: "${ .status != 404 }",
		},
		{
			name: "field greater than number",
			build: func() string {
				return GreaterThan(Field("count"), Number(10))
			},
			expected: "${ .count > 10 }",
		},
		{
			name: "field greater than or equal",
			build: func() string {
				return GreaterThanOrEqual(Field("status"), Number(500))
			},
			expected: "${ .status >= 500 }",
		},
		{
			name: "field less than number",
			build: func() string {
				return LessThan(Field("count"), Number(100))
			},
			expected: "${ .count < 100 }",
		},
		{
			name: "field less than or equal",
			build: func() string {
				return LessThanOrEqual(Field("count"), Number(100))
			},
			expected: "${ .count <= 100 }",
		},
		{
			name: "AND condition",
			build: func() string {
				return And(
					Equals(Field("status"), Number(200)),
					Equals(Field("type"), Literal("success")),
				)
			},
			expected: "${ .status == 200 && .type == \"success\" }",
		},
		{
			name: "OR condition",
			build: func() string {
				return Or(
					Equals(Field("status"), Number(200)),
					Equals(Field("status"), Number(201)),
				)
			},
			expected: "${ .status == 200 || .status == 201 }",
		},
		{
			name: "NOT condition",
			build: func() string {
				return Not(Equals(Field("status"), Number(404)))
			},
			expected: "${ !(.status == 404) }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.build()
			if result != tt.expected {
				t.Errorf("%s = %q, want %q", tt.name, result, tt.expected)
			}
		})
	}
}

// TestVarInCondition tests that Var() generates correct $context reference
func TestVarInCondition(t *testing.T) {
	result := Var("apiURL")
	expected := "$context.apiURL"
	if result != expected {
		t.Errorf("Var(%q) = %q, want %q", "apiURL", result, expected)
	}
}

// TestFieldInCondition tests that Field() generates correct dot-prefix reference
func TestFieldInCondition(t *testing.T) {
	result := Field("status")
	expected := ".status"
	if result != expected {
		t.Errorf("Field(%q) = %q, want %q", "status", result, expected)
	}
}

// TestComplexInterpolation tests complex real-world interpolation scenarios
func TestComplexInterpolation(t *testing.T) {
	tests := []struct {
		name     string
		build    func() string
		expected string
	}{
		{
			name: "API URL with version and path",
			build: func() string {
				baseURL := VarRef("baseURL")
				version := VarRef("version")
				return Interpolate(baseURL, "/v", version, "/posts/1")
			},
			expected: "${ $context.baseURL + \"/v\" + $context.version + \"/posts/1\" }",
		},
		{
			name: "Authorization header",
			build: func() string {
				token := VarRef("token")
				return Interpolate("Bearer ", token)
			},
			expected: "${ \"Bearer \" + $context.token }",
		},
		{
			name: "Dynamic endpoint with port",
			build: func() string {
				host := VarRef("host")
				port := VarRef("port")
				return Interpolate("https://", host, ":", port, "/api")
			},
			expected: "${ \"https://\" + $context.host + \":\" + $context.port + \"/api\" }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.build()
			if result != tt.expected {
				t.Errorf("%s = %q, want %q", tt.name, result, tt.expected)
			}
		})
	}
}
