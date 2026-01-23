package workflow

import (
	"fmt"
)

// SetArgs is an alias for SetTaskConfig (Pulumi-style args pattern).
type SetArgs = SetTaskConfig

// Set creates a SET task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Set("init", &workflow.SetArgs{
//	    Variables: map[string]string{
//	        "x": "1",
//	        "y": "${.input.value}",
//	        "computed": "${.a + .b}",
//	    },
//	})
func Set(name string, args *SetArgs) *Task {
	if args == nil {
		args = &SetArgs{}
	}

	// Initialize maps if nil
	if args.Variables == nil {
		args.Variables = make(map[string]string)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSet,
		Config: args,
	}
}

// coerceToString converts various types to strings for SET tasks.
func coerceToString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case TaskFieldRef:
		return v.Expression()
	case Ref:
		// Check if this Ref has a resolved value (StringValue interface)
		// During synthesis, we should use the actual value instead of expressions
		if stringVal, ok := v.(interface{ Value() string }); ok {
			// Has a Value() method - use the resolved value for synthesis
			return stringVal.Value()
		}
		// Fallback to expression (for runtime-only refs)
		return v.Expression()
	case int:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case float64:
		return fmt.Sprintf("%f", v)
	case bool:
		return fmt.Sprintf("%t", v)
	default:
		return fmt.Sprintf("%v", v)
	}
}
