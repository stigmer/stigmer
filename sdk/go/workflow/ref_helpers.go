package workflow

import (
	"fmt"
)

// Ref is a minimal interface that represents a typed reference to a value.
// This allows the workflow package to work with context references without
// importing the stigmer package (avoiding import cycles).
//
// The stigmer.Ref types (StringRef, IntRef, BoolRef, ObjectRef) all
// implement this interface.
type Ref interface {
	Expression() string
	Name() string
}

// IntValue represents an int-valued reference that can provide its value.
// This is used for numeric parameters like timeouts.
type IntValue interface {
	Value() int
}

// BoolValue represents a bool-valued reference that can provide its value.
// This is used for boolean parameters.
type BoolValue interface {
	Value() bool
}

// StringValue represents a string-valued reference that can provide its value.
// This is used for string parameters like org, name, etc.
type StringValue interface {
	Value() string
}

// toExpression converts various input types to expression strings.
// 
// SMART RESOLUTION: If the value is a known constant (StringValue, IntValue, BoolValue),
// returns the actual value. If it's a runtime expression (Ref without value), returns
// the JQ expression.
//
// This enables the SDK to resolve values at synthesis time when possible, avoiding
// unnecessary runtime JQ evaluation for static configuration.
//
// Supported types:
//   - string: returned as-is
//   - int, int32, int64: converted to string representation
//   - bool: converted to string "true" or "false"
//   - float32, float64: converted to string representation
//   - StringValue: returns the known value (synthesis-time resolution)
//   - IntValue: returns the known value as string
//   - BoolValue: returns the known value as string
//   - Ref: calls Expression() to get JQ expression (runtime resolution)
//
// Examples (synthesis-time resolution):
//
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	endpoint := apiBase.Concat("/users")
//	toExpression(endpoint)  // "https://api.example.com/users" (resolved!)
//
// Examples (runtime resolution):
//
//	fetchTask := wf.HttpGet("fetch", "https://api.example.com")
//	title := fetchTask.Field("title")
//	toExpression(title)  // "${ $context.fetch.title }" (runtime JQ)
func toExpression(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case int:
		return fmt.Sprintf("%d", v)
	case int32:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case bool:
		return fmt.Sprintf("%t", v)
	case float32:
		return fmt.Sprintf("%f", v)
	case float64:
		return fmt.Sprintf("%f", v)
	
	// SMART RESOLUTION: Check for known values BEFORE falling back to Expression()
	case StringValue:
		// This is a known string value - return it directly
		return v.Value()
	case IntValue:
		// This is a known int value - convert to string
		return fmt.Sprintf("%d", v.Value())
	case BoolValue:
		// This is a known bool value - convert to string
		return fmt.Sprintf("%t", v.Value())
	
	// Runtime expression (task outputs, computed values)
	case Ref:
		return v.Expression()
	
	default:
		// Fallback: convert to string
		return fmt.Sprintf("%v", value)
	}
}

// toInt32 converts various input types to int32.
// This helper enables timeout and numeric parameters to accept both
// legacy int values and new typed IntRef values.
//
// Supported types:
//   - int, int32, int64: converted to int32
//   - IntValue: returns the initial value (used during synthesis)
//
// Examples:
//
//	toInt32(30)                       // 30
//	toInt32(ctx.SetInt("timeout", 60)) // 60
func toInt32(value interface{}) int32 {
	switch v := value.(type) {
	case int:
		return int32(v)
	case int32:
		return v
	case int64:
		return int32(v)
	case IntValue:
		return int32(v.Value())
	default:
		return 0
	}
}

// toBool converts various input types to bool.
// This helper enables boolean parameters to accept both
// legacy bool values and new typed BoolRef values.
//
// Supported types:
//   - bool: returned as-is
//   - BoolValue: returns the initial value (used during synthesis)
//
// Examples:
//
//	toBool(true)                        // true
//	toBool(ctx.SetBool("enabled", true)) // true
func toBool(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case BoolValue:
		return v.Value()
	default:
		return false
	}
}
