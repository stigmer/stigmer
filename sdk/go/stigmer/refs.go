package stigmer

import (
	"fmt"
	"strings"
)

// Ref is the base interface for all typed references.
// A Ref represents a variable that can be used in two ways:
//
// 1. Compile-time resolution: ${variableName} placeholders are replaced with
//    actual values during synthesis. This is the default for context variables.
//
// 2. Runtime resolution: ${ $context.variableName } JQ expressions are evaluated
//    at workflow execution time. This is used for computed values and task outputs.
//
// All Ref types must implement:
// - Expression(): Generate JQ expressions for runtime evaluation
// - ToValue(): Provide the value for compile-time interpolation
type Ref interface {
	// Expression returns the JQ expression that references this value.
	// For example: "${ $context.apiURL }"
	Expression() string

	// Name returns the variable name in the context
	Name() string

	// IsSecret returns true if this reference contains sensitive data
	IsSecret() bool

	// ToValue returns the value for synthesis/serialization.
	// This is used during workflow generation to inject context variables.
	// Returns a JSON-compatible value (string, int, bool, map, slice, etc.)
	ToValue() interface{}
}

// baseRef provides common functionality for all Ref implementations.
type baseRef struct {
	name         string
	isSecret     bool
	isComputed   bool   // If true, name contains full expression, not just variable name
	rawExpression string // For computed expressions, the full expression without ${ }
}

func (r *baseRef) Name() string {
	return r.name
}

func (r *baseRef) IsSecret() bool {
	return r.isSecret
}

func (r *baseRef) Expression() string {
	if r.isComputed {
		return fmt.Sprintf("${ %s }", r.rawExpression)
	}
	return fmt.Sprintf("${ $context.%s }", r.name)
}

// =============================================================================
// StringRef - Reference to a string value
// =============================================================================

// StringRef represents a reference to a string value in the workflow context.
// It provides methods for string manipulation and transformation that generate
// JQ expressions for runtime evaluation.
//
// Example:
//
//	apiURL := ctx.SetString("apiURL", "https://api.example.com")
//	endpoint := apiURL.Concat("/users")  // "${ $context.apiURL + "/users" }"
type StringRef struct {
	baseRef
	value string // Initial value (used during synthesis)
}

// Value returns the initial value of this string reference (used during synthesis).
func (s *StringRef) Value() string {
	return s.value
}

// ToValue implements Ref.ToValue() for synthesis/serialization.
// Returns the string value as interface{} for JSON serialization.
func (s *StringRef) ToValue() interface{} {
	return s.value
}

// Concat creates a new StringRef that concatenates this string with other strings.
// 
// SMART RESOLUTION: If all values are known at synthesis time (not runtime expressions),
// the concatenation is computed immediately and returned as a resolved value.
// Otherwise, it generates a JQ expression for runtime evaluation.
//
// Example (resolved at synthesis):
//
//	apiURL := ctx.SetString("apiURL", "https://api.example.com")
//	endpoint := apiURL.Concat("/users")
//	// Result: value = "https://api.example.com/users" (resolved!)
//
// Example (runtime expression):
//
//	userID := fetchTask.Field("id")  // Runtime value from task output
//	url := apiURL.Concat("/users/", userID)
//	// Result: "${ $context.apiURL + "/users/" + $context.fetchTask.id }"
func (s *StringRef) Concat(parts ...interface{}) *StringRef {
	// Track if all parts are known values (can resolve immediately)
	allKnown := !s.isComputed
	
	// Build both the resolved value AND the expression (we'll use one or the other)
	var resolvedParts []string
	var expressions []string
	
	// Add base value/expression
	if !s.isComputed {
		resolvedParts = append(resolvedParts, s.value)
		expressions = append(expressions, fmt.Sprintf("$context.%s", s.name))
	} else {
		allKnown = false
		expressions = append(expressions, s.rawExpression)
	}

	// Process each part
	for _, part := range parts {
		switch v := part.(type) {
		case string:
			// Literal string - always known
			resolvedParts = append(resolvedParts, v)
			expressions = append(expressions, fmt.Sprintf(`"%s"`, v))
			
		case *StringRef:
			// Another StringRef - check if it's known
			if !v.isComputed {
				resolvedParts = append(resolvedParts, v.value)
				expressions = append(expressions, fmt.Sprintf("$context.%s", v.name))
			} else {
				allKnown = false
				expressions = append(expressions, v.rawExpression)
			}
		
		case *IntRef:
			// IntRef - check if it's known
			if !v.isComputed {
				resolvedParts = append(resolvedParts, fmt.Sprintf("%d", v.value))
				expressions = append(expressions, fmt.Sprintf("$context.%s", v.name))
			} else {
				allKnown = false
				expressions = append(expressions, v.rawExpression)
			}
		
		case *BoolRef:
			// BoolRef - check if it's known
			if !v.isComputed {
				resolvedParts = append(resolvedParts, fmt.Sprintf("%t", v.value))
				expressions = append(expressions, fmt.Sprintf("$context.%s", v.name))
			} else {
				allKnown = false
				expressions = append(expressions, v.rawExpression)
			}
			
		case Ref:
			// Other Ref types (like TaskFieldRef) - always runtime
			allKnown = false
			expressions = append(expressions, fmt.Sprintf("($context.%s | tostring)", v.Name()))
			
		default:
			// Fallback - literal value
			resolvedParts = append(resolvedParts, fmt.Sprintf("%v", v))
			expressions = append(expressions, fmt.Sprintf(`"%v"`, v))
		}
	}

	// SMART DECISION: Can we resolve this now, or defer to runtime?
	if allKnown {
		// All parts are known - compute the final value NOW
		finalValue := strings.Join(resolvedParts, "")
		return &StringRef{
			baseRef: baseRef{
				name:         "", // Not a context variable, it's a resolved literal
				isSecret:     s.isSecret,
				isComputed:   false, // ← KEY: This is a known value!
				rawExpression: "",
			},
			value: finalValue, // ← The actual resolved string
		}
	}

	// At least one part is a runtime value - create expression
	result := strings.Join(expressions, " + ")
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     s.isSecret,
			isComputed:   true,
			rawExpression: result,
		},
		value: "", // Runtime value, not known at synthesis time
	}
}

// Upper creates a new StringRef that converts this string to uppercase.
// It generates a JQ expression for runtime transformation.
//
// Example:
//
//	name := ctx.SetString("name", "alice")
//	upperName := name.Upper()  // "${ $context.name | ascii_upcase }"
func (s *StringRef) Upper() *StringRef {
	var expr string
	if s.isComputed {
		expr = fmt.Sprintf("(%s | ascii_upcase)", s.rawExpression)
	} else {
		expr = fmt.Sprintf("($context.%s | ascii_upcase)", s.name)
	}
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     s.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: "",
	}
}

// Lower creates a new StringRef that converts this string to lowercase.
// It generates a JQ expression for runtime transformation.
//
// Example:
//
//	name := ctx.SetString("name", "ALICE")
//	lowerName := name.Lower()  // "${ $context.name | ascii_downcase }"
func (s *StringRef) Lower() *StringRef {
	var expr string
	if s.isComputed {
		expr = fmt.Sprintf("(%s | ascii_downcase)", s.rawExpression)
	} else {
		expr = fmt.Sprintf("($context.%s | ascii_downcase)", s.name)
	}
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     s.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: "",
	}
}

// Prepend creates a new StringRef that prepends a prefix to this string.
// It's a convenience method for common string operations.
//
// Example:
//
//	path := ctx.SetString("path", "users")
//	fullPath := path.Prepend("/api/")  // "${ "/api/" + $context.path }"
func (s *StringRef) Prepend(prefix string) *StringRef {
	var expr string
	if s.isComputed {
		expr = fmt.Sprintf(`("%s" + %s)`, prefix, s.rawExpression)
	} else {
		expr = fmt.Sprintf(`("%s" + $context.%s)`, prefix, s.name)
	}
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     s.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: "",
	}
}

// Append creates a new StringRef that appends a suffix to this string.
// It's a convenience method for common string operations.
//
// Example:
//
//	base := ctx.SetString("base", "https://api.example.com")
//	url := base.Append("/v1")  // "${ $context.base + "/v1" }"
func (s *StringRef) Append(suffix string) *StringRef {
	var expr string
	if s.isComputed {
		expr = fmt.Sprintf(`(%s + "%s")`, s.rawExpression, suffix)
	} else {
		expr = fmt.Sprintf(`($context.%s + "%s")`, s.name, suffix)
	}
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     s.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: "",
	}
}

// =============================================================================
// IntRef - Reference to an integer value
// =============================================================================

// IntRef represents a reference to an integer value in the workflow context.
// It provides methods for arithmetic operations that generate JQ expressions
// for runtime evaluation.
//
// Example:
//
//	retries := ctx.SetInt("retries", 3)
//	increased := retries.Add(ctx.SetInt("additional", 2))
//	// Result: "${ $context.retries + $context.additional }"
type IntRef struct {
	baseRef
	value int // Initial value (used during synthesis)
}

// Value returns the initial value of this integer reference (used during synthesis).
func (i *IntRef) Value() int {
	return i.value
}

// ToValue implements Ref.ToValue() for synthesis/serialization.
// Returns the integer value as interface{} for JSON serialization.
func (i *IntRef) ToValue() interface{} {
	return i.value
}

// Add creates a new IntRef that adds another integer to this one.
// It generates a JQ expression for runtime addition.
//
// Example:
//
//	base := ctx.SetInt("base", 10)
//	total := base.Add(ctx.SetInt("increment", 5))
//	// Result: "${ $context.base + $context.increment }"
func (i *IntRef) Add(other *IntRef) *IntRef {
	var left, right string
	if i.isComputed {
		left = i.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", i.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &IntRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s + %s)", left, right),
		},
		value: 0,
	}
}

// Subtract creates a new IntRef that subtracts another integer from this one.
// It generates a JQ expression for runtime subtraction.
func (i *IntRef) Subtract(other *IntRef) *IntRef {
	var left, right string
	if i.isComputed {
		left = i.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", i.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &IntRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s - %s)", left, right),
		},
		value: 0,
	}
}

// Multiply creates a new IntRef that multiplies this integer by another.
// It generates a JQ expression for runtime multiplication.
func (i *IntRef) Multiply(other *IntRef) *IntRef {
	var left, right string
	if i.isComputed {
		left = i.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", i.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &IntRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s * %s)", left, right),
		},
		value: 0,
	}
}

// Divide creates a new IntRef that divides this integer by another.
// It generates a JQ expression for runtime division.
func (i *IntRef) Divide(other *IntRef) *IntRef {
	var left, right string
	if i.isComputed {
		left = i.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", i.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &IntRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s / %s)", left, right),
		},
		value: 0,
	}
}

// =============================================================================
// BoolRef - Reference to a boolean value
// =============================================================================

// BoolRef represents a reference to a boolean value in the workflow context.
// It provides methods for boolean logic operations that generate JQ expressions
// for runtime evaluation.
//
// Example:
//
//	isProd := ctx.SetBool("isProd", true)
//	isDebug := ctx.SetBool("isDebug", false)
//	shouldLog := isProd.And(isDebug.Not())
//	// Result: "${ $context.isProd and ($context.isDebug | not) }"
type BoolRef struct {
	baseRef
	value bool // Initial value (used during synthesis)
}

// Value returns the initial value of this boolean reference (used during synthesis).
// Returns the boolean value as interface{} for JSON serialization.
func (b *BoolRef) Value() bool {
	return b.value
}

// ToValue implements Ref.ToValue() for synthesis/serialization.
// Returns the boolean value as interface{} for JSON serialization.
func (b *BoolRef) ToValue() interface{} {
	return b.value
}

// And creates a new BoolRef that performs logical AND with another boolean.
// It generates a JQ expression for runtime evaluation.
//
// Example:
//
//	hasAccess := ctx.SetBool("hasAccess", true)
//	isEnabled := ctx.SetBool("isEnabled", true)
//	canProceed := hasAccess.And(isEnabled)
//	// Result: "${ $context.hasAccess and $context.isEnabled }"
func (b *BoolRef) And(other *BoolRef) *BoolRef {
	var left, right string
	if b.isComputed {
		left = b.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", b.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &BoolRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s and %s)", left, right),
		},
		value: false,
	}
}

// Or creates a new BoolRef that performs logical OR with another boolean.
// It generates a JQ expression for runtime evaluation.
func (b *BoolRef) Or(other *BoolRef) *BoolRef {
	var left, right string
	if b.isComputed {
		left = b.rawExpression
	} else {
		left = fmt.Sprintf("$context.%s", b.name)
	}
	if other.isComputed {
		right = other.rawExpression
	} else {
		right = fmt.Sprintf("$context.%s", other.name)
	}
	return &BoolRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: fmt.Sprintf("(%s or %s)", left, right),
		},
		value: false,
	}
}

// Not creates a new BoolRef that negates this boolean.
// It generates a JQ expression for runtime evaluation.
//
// Example:
//
//	isEnabled := ctx.SetBool("isEnabled", true)
//	isDisabled := isEnabled.Not()
//	// Result: "${ ($context.isEnabled | not) }"
func (b *BoolRef) Not() *BoolRef {
	var expr string
	if b.isComputed {
		expr = fmt.Sprintf("(%s | not)", b.rawExpression)
	} else {
		expr = fmt.Sprintf("($context.%s | not)", b.name)
	}
	return &BoolRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: expr,
		},
		value: false,
	}
}

// =============================================================================
// ObjectRef - Reference to an object/map value
// =============================================================================

// ObjectRef represents a reference to an object (map) value in the workflow context.
// It provides methods for accessing nested fields that generate JQ expressions
// for runtime evaluation.
//
// Example:
//
//	config := ctx.SetObject("config", map[string]interface{}{
//	    "database": map[string]interface{}{
//	        "host": "localhost",
//	        "port": 5432,
//	    },
//	})
//	dbHost := config.Field("database").Field("host")
//	// Result: "${ $context.config.database.host }"
type ObjectRef struct {
	baseRef
	value map[string]interface{} // Initial value (used during synthesis)
}

// Value returns the initial value of this object reference (used during synthesis).
func (o *ObjectRef) Value() map[string]interface{} {
	return o.value
}

// ToValue implements Ref.ToValue() for synthesis/serialization.
// Returns the object (map) value as interface{} for JSON serialization.
func (o *ObjectRef) ToValue() interface{} {
	return o.value
}

// Field accesses a nested field in the object and returns a new ObjectRef.
// It generates a JQ expression for runtime field access.
//
// Example:
//
//	config := ctx.SetObject("config", configMap)
//	database := config.Field("database")
//	// Result: "${ $context.config.database }"
func (o *ObjectRef) Field(name string) *ObjectRef {
	var expr string
	if o.isComputed {
		expr = fmt.Sprintf("(%s.%s)", o.rawExpression, name)
	} else {
		expr = fmt.Sprintf("($context.%s.%s)", o.name, name)
	}
	return &ObjectRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     o.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: nil, // Nested value, not known at synthesis time
	}
}

// FieldAsString accesses a nested field and returns it as a StringRef.
// This is useful when you know the field contains a string value.
//
// Example:
//
//	config := ctx.SetObject("config", configMap)
//	dbHost := config.FieldAsString("database", "host")
//	// Result: "${ $context.config.database.host }"
func (o *ObjectRef) FieldAsString(fields ...string) *StringRef {
	var expr string
	if o.isComputed {
		expr = o.rawExpression
	} else {
		expr = fmt.Sprintf("$context.%s", o.name)
	}
	for _, field := range fields {
		expr = fmt.Sprintf("(%s.%s)", expr, field)
	}
	return &StringRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     o.isSecret,
			isComputed:   true,
			rawExpression: expr,
		},
		value: "",
	}
}

// FieldAsInt accesses a nested field and returns it as an IntRef.
// This is useful when you know the field contains an integer value.
func (o *ObjectRef) FieldAsInt(fields ...string) *IntRef {
	var expr string
	if o.isComputed {
		expr = o.rawExpression
	} else {
		expr = fmt.Sprintf("$context.%s", o.name)
	}
	for _, field := range fields {
		expr = fmt.Sprintf("(%s.%s)", expr, field)
	}
	return &IntRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: expr,
		},
		value: 0,
	}
}

// FieldAsBool accesses a nested field and returns it as a BoolRef.
// This is useful when you know the field contains a boolean value.
func (o *ObjectRef) FieldAsBool(fields ...string) *BoolRef {
	var expr string
	if o.isComputed {
		expr = o.rawExpression
	} else {
		expr = fmt.Sprintf("$context.%s", o.name)
	}
	for _, field := range fields {
		expr = fmt.Sprintf("(%s.%s)", expr, field)
	}
	return &BoolRef{
		baseRef: baseRef{
			name:         "",
			isSecret:     false,
			isComputed:   true,
			rawExpression: expr,
		},
		value: false,
	}
}
