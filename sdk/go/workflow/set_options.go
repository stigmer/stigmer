package workflow

import (
	"fmt"
)

// SetOption is a functional option for configuring a SET task.
type SetOption func(*SetTaskConfig)

// Set creates a SET task with functional options.
// This is the high-level API that wraps the generated SetTask constructor.
//
// Example:
//
//	task := workflow.Set("init",
//	    workflow.SetVar("x", "1"),
//	    workflow.SetVar("y", "${.input.value}"),
//	    workflow.SetVar("computed", "${.a + .b}"),
//	)
func Set(name string, opts ...SetOption) *Task {
	config := &SetTaskConfig{
		Variables: make(map[string]string),
	}

	// Apply all options
	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSet,
		Config: config,
	}
}

// SetVar adds a variable to set in the workflow state.
//
// The value can be:
//   - A literal string: "hello"
//   - An expression: "${.input.value}"
//   - A TaskFieldRef: task.Field("fieldName")
//   - Any other type (converted to string)
//
// Example:
//
//	workflow.Set("init",
//	    workflow.SetVar("name", "John"),
//	    workflow.SetVar("count", "42"),
//	    workflow.SetVar("computed", "${.x + .y}"),
//	)
func SetVar(key string, value interface{}) SetOption {
	return func(c *SetTaskConfig) {
		c.Variables[key] = coerceToString(value)
	}
}

// SetVars adds multiple variables from a map.
//
// Example:
//
//	workflow.Set("init",
//	    workflow.SetVars(map[string]interface{}{
//	        "x": "1",
//	        "y": "2",
//	        "z": fetchTask.Field("result"),
//	    }),
//	)
func SetVars(vars map[string]interface{}) SetOption {
	return func(c *SetTaskConfig) {
		for key, value := range vars {
			c.Variables[key] = coerceToString(value)
		}
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
