package workflow

import (
	"fmt"
	"reflect"
	"strings"
)

// ============================================================================
// Internal Helper Functions
// ============================================================================

// isEmpty checks if a value is considered "empty" for proto marshaling.
// This is used internally by generated ToProto() methods to omit empty fields.
//
// Empty values:
//   - strings: ""
//   - maps: nil or empty
//   - slices: nil or empty
//   - numbers: 0
//   - booleans: false
//   - nil values
func isEmpty(v interface{}) bool {
	if v == nil {
		return true
	}
	
	val := reflect.ValueOf(v)
	
	switch val.Kind() {
	case reflect.String:
		return val.String() == ""
	case reflect.Map, reflect.Slice, reflect.Array:
		return val.Len() == 0
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return val.Int() == 0
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return val.Uint() == 0
	case reflect.Float32, reflect.Float64:
		return val.Float() == 0
	case reflect.Bool:
		return !val.Bool()
	case reflect.Ptr, reflect.Interface:
		return val.IsNil()
	default:
		return false
	}
}

// ============================================================================
// String Interpolation Helpers
// ============================================================================

// Interpolate creates a string by concatenating multiple values.
// This is a helper for building dynamic strings from task outputs, secrets,
// and environment variables.
//
// Example:
//
//	workflow.Interpolate("Hello ", userName, " from ", location)
//	workflow.Interpolate("Bearer ", workflow.RuntimeSecret("API_TOKEN"))
//	workflow.Interpolate("https://api.example.com/repos/", repoName, "/pulls/", prNumber)
func Interpolate(parts ...interface{}) string {
	var result strings.Builder
	
	for _, part := range parts {
		switch v := part.(type) {
		case string:
			result.WriteString(v)
		case int, int32, int64:
			result.WriteString(fmt.Sprintf("%d", v))
		case float32, float64:
			result.WriteString(fmt.Sprintf("%f", v))
		case bool:
			result.WriteString(fmt.Sprintf("%t", v))
		case Ref:
			// If it's a reference (TaskFieldRef, etc), get its expression
			result.WriteString(v.Expression())
		default:
			result.WriteString(fmt.Sprintf("%v", v))
		}
	}
	
	return result.String()
}

// Concat is an alias for Interpolate for more intuitive string concatenation.
//
// Example:
//
//	workflow.Concat(apiBase, "/users/", userId)
func Concat(parts ...interface{}) string {
	return Interpolate(parts...)
}

// ============================================================================
// Runtime Values (Secrets and Environment Variables)
// ============================================================================

// Note: RuntimeSecret and RuntimeEnv are defined in runtime_env.go with
// comprehensive documentation about security patterns and usage.

// RuntimeConfig creates a reference to a runtime configuration value.
// The actual value will be resolved at runtime from the workflow's
// configuration.
//
// Example:
//
//	workflow.RuntimeConfig("timeout")      // -> "${config.timeout}"
//	workflow.RuntimeConfig("max_retries")  // -> "${config.max_retries}"
func RuntimeConfig(key string) string {
	return "${config." + key + "}"
}

// ============================================================================
// Expression Builders
// ============================================================================

// Expr creates a raw expression string.
// Use this when you need to write custom expressions.
//
// Example:
//
//	workflow.Expr("${.status == 'active' && .count > 10}")
//	workflow.Expr("${now()}")
//	workflow.Expr("${.items.length}")
func Expr(expression string) string {
	// If already wrapped in ${...}, return as-is
	if strings.HasPrefix(expression, "${") && strings.HasSuffix(expression, "}") {
		return expression
	}
	// Otherwise, wrap it
	return "${" + expression + "}"
}

// Now returns a reference to the current timestamp.
//
// Example:
//
//	workflow.SetVar("createdAt", workflow.Now())  // -> "${now()}"
func Now() string {
	return "${now()}"
}

// UUID returns a reference to a new UUID.
//
// Example:
//
//	workflow.SetVar("requestId", workflow.UUID())  // -> "${uuid()}"
func UUID() string {
	return "${uuid()}"
}

// ============================================================================
// JSON Path Helpers
// ============================================================================

// JSONPath creates a JSONPath expression for extracting values.
//
// Example:
//
//	workflow.JSONPath("$.users[0].name")
//	workflow.JSONPath("$.data.items[*].id")
func JSONPath(path string) string {
	return "${jsonPath('" + path + "')}"
}

// ============================================================================
// Conditional Helpers
// ============================================================================

// IfThenElse creates a conditional expression.
//
// Example:
//
//	workflow.IfThenElse("${.status == 200}", "success", "error")
func IfThenElse(condition, thenValue, elseValue interface{}) string {
	return fmt.Sprintf("${%v ? %v : %v}", 
		coerceToString(condition),
		coerceToString(thenValue),
		coerceToString(elseValue))
}

// ============================================================================
// Type Conversion Helpers
// ============================================================================

// ToString converts a value to string in an expression.
//
// Example:
//
//	workflow.ToString(statusCode)  // -> "${toString(.statusCode)}"
func ToString(value interface{}) string {
	return "${toString(" + coerceToString(value) + ")}"
}

// ToInt converts a value to integer in an expression.
//
// Example:
//
//	workflow.ToInt(count)  // -> "${toInt(.count)}"
func ToInt(value interface{}) string {
	return "${toInt(" + coerceToString(value) + ")}"
}

// ToFloat converts a value to float in an expression.
//
// Example:
//
//	workflow.ToFloat(price)  // -> "${toFloat(.price)}"
func ToFloat(value interface{}) string {
	return "${toFloat(" + coerceToString(value) + ")}"
}

// ToBool converts a value to boolean in an expression.
//
// Example:
//
//	workflow.ToBool(isActive)  // -> "${toBool(.isActive)}"
func ToBool(value interface{}) string {
	return "${toBool(" + coerceToString(value) + ")}"
}

// ============================================================================
// Collection Helpers
// ============================================================================

// Length returns the length of a collection or string.
//
// Example:
//
//	workflow.Length(items)  // -> "${length(.items)}"
func Length(value interface{}) string {
	return "${length(" + coerceToString(value) + ")}"
}

// Contains checks if a collection contains a value.
//
// Example:
//
//	workflow.Contains(tags, "production")  // -> "${contains(.tags, 'production')}"
func Contains(collection, value interface{}) string {
	return fmt.Sprintf("${contains(%v, %v)}", 
		coerceToString(collection),
		coerceToString(value))
}

// Join joins collection elements with a separator.
//
// Example:
//
//	workflow.Join(tags, ", ")  // -> "${join(.tags, ', ')}"
func Join(collection interface{}, separator string) string {
	return fmt.Sprintf("${join(%v, '%v')}", 
		coerceToString(collection),
		separator)
}

// ============================================================================
// Math Helpers
// ============================================================================

// Add adds two or more numbers.
//
// Example:
//
//	workflow.Add(count, 1)  // -> "${.count + 1}"
func Add(values ...interface{}) string {
	if len(values) == 0 {
		return "0"
	}
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = coerceToString(v)
	}
	return "${" + strings.Join(parts, " + ") + "}"
}

// Subtract subtracts numbers.
//
// Example:
//
//	workflow.Subtract(total, discount)  // -> "${.total - .discount}"
func Subtract(a, b interface{}) string {
	return fmt.Sprintf("${%v - %v}", coerceToString(a), coerceToString(b))
}

// Multiply multiplies numbers.
//
// Example:
//
//	workflow.Multiply(price, quantity)  // -> "${.price * .quantity}"
func Multiply(values ...interface{}) string {
	if len(values) == 0 {
		return "0"
	}
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = coerceToString(v)
	}
	return "${" + strings.Join(parts, " * ") + "}"
}

// Divide divides two numbers.
//
// Example:
//
//	workflow.Divide(total, count)  // -> "${.total / .count}"
func Divide(a, b interface{}) string {
	return fmt.Sprintf("${%v / %v}", coerceToString(a), coerceToString(b))
}
