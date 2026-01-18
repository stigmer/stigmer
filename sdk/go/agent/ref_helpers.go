package agent

import (
	"fmt"
)

// Ref is a minimal interface that represents a typed reference to a value.
// This allows the agent package to work with context references without
// importing the stigmer package (avoiding import cycles).
//
// The stigmer.Ref types (StringRef, IntRef, BoolRef, ObjectRef) all
// implement this interface.
type Ref interface {
	Expression() string
	Name() string
}

// StringValue represents a string-valued reference that can provide its value.
// This is used for string parameters like name, instructions, description.
type StringValue interface {
	Value() string
}

// toExpression converts various input types to expression strings.
// This helper enables agent builders to accept both legacy string values
// and new typed Ref values, maintaining backward compatibility while
// enabling type safety.
//
// Supported types:
//   - string: returned as-is
//   - StringValue: returns the initial value (used during synthesis)
//   - Ref: calls Expression() to get JQ expression (though rarely needed for agents)
//
// Examples:
//
//	toExpression("code-reviewer")             // "code-reviewer"
//	toExpression(ctx.SetString("name", "...")) // Value from context
func toExpression(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case StringValue:
		// For synthesis, we need the actual value, not an expression
		return v.Value()
	case Ref:
		// Fallback: get the expression (though this is uncommon for agents)
		return v.Expression()
	default:
		// Fallback: convert to string
		return fmt.Sprintf("%v", value)
	}
}
