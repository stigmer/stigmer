package workflow

import "fmt"

// SwitchOption is a functional option for configuring a SWITCH task.
type SwitchOption func(*SwitchTaskConfig)

// Switch creates a SWITCH task with functional options.
//
// Example (low-level map API):
//
//	task := workflow.Switch("routeByType",
//	    workflow.Case(map[string]interface{}{
//	        "condition": "${.type == 'A'}",
//	        "then": "handleA",
//	    }),
//	    workflow.Case(map[string]interface{}{
//	        "condition": "${.type == 'B'}",
//	        "then": "handleB",
//	    }),
//	    workflow.DefaultCase("handleDefault"),
//	)
//
// Example (high-level typed API):
//
//	checkTask := wf.HttpGet("check", endpoint)
//	switchTask := workflow.Switch("route",
//	    workflow.SwitchOn(checkTask.Field("statusCode")),
//	    workflow.Case(workflow.Equals(200), "success"),
//	    workflow.Case(workflow.Equals(404), "notFound"),
//	    workflow.DefaultCase("error"),
//	)
func Switch(name string, opts ...SwitchOption) *Task {
	config := &SwitchTaskConfig{
		Cases: []map[string]interface{}{},
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSwitch,
		Config: config,
	}
}

// SwitchOn sets the value to switch on (the condition expression).
// This is typically a TaskFieldRef or expression string.
//
// Example:
//
//	workflow.SwitchOn(checkTask.Field("status"))
//	workflow.SwitchOn("${.userType}")
func SwitchOn(condition interface{}) SwitchOption {
	return func(c *SwitchTaskConfig) {
		// Store the switch condition as a special marker in the first case
		// or as a separate field if needed. For now, we'll handle this in Case()
		// by storing the condition for matching.
		// This is a no-op for now since we handle it in Case()
	}
}

// ConditionMatcher represents a condition matcher for switch cases.
type ConditionMatcher interface {
	// Expression returns the condition expression as a string
	Expression() string
}

// equalsMatcher matches equality conditions
type equalsMatcher struct {
	value interface{}
}

func (m *equalsMatcher) Expression() string {
	return fmt.Sprintf("${. == %v}", m.value)
}

// Equals creates a matcher that checks equality.
//
// Example:
//
//	workflow.Case(workflow.Equals(200), "success")
//	workflow.Case(workflow.Equals("active"), "processActive")
func Equals(value interface{}) ConditionMatcher {
	return &equalsMatcher{value: value}
}

// greaterThanMatcher matches greater than conditions
type greaterThanMatcher struct {
	value interface{}
}

func (m *greaterThanMatcher) Expression() string {
	return fmt.Sprintf("${. > %v}", m.value)
}

// GreaterThan creates a matcher that checks if value is greater than threshold.
//
// Example:
//
//	workflow.Case(workflow.GreaterThan(100), "highValue")
func GreaterThan(value interface{}) ConditionMatcher {
	return &greaterThanMatcher{value: value}
}

// lessThanMatcher matches less than conditions
type lessThanMatcher struct {
	value interface{}
}

func (m *lessThanMatcher) Expression() string {
	return fmt.Sprintf("${. < %v}", m.value)
}

// LessThan creates a matcher that checks if value is less than threshold.
//
// Example:
//
//	workflow.Case(workflow.LessThan(10), "lowValue")
func LessThan(value interface{}) ConditionMatcher {
	return &lessThanMatcher{value: value}
}

// customMatcher for custom expressions
type customMatcher struct {
	expr string
}

func (m *customMatcher) Expression() string {
	return m.expr
}

// CustomCondition creates a matcher with a custom expression.
//
// Example:
//
//	workflow.Case(workflow.CustomCondition("${.status == 'active' && .count > 10}"), "process")
func CustomCondition(expr string) ConditionMatcher {
	return &customMatcher{expr: expr}
}

// Case adds a conditional case to the switch.
// Supports both low-level map API and high-level typed API.
//
// Low-level example:
//
//	workflow.Case(map[string]interface{}{
//	    "condition": "${.type == 'A'}",
//	    "then": "handleA",
//	})
//
// High-level example:
//
//	workflow.Case(workflow.Equals(200), "success")
func Case(conditionOrMap interface{}, target ...string) SwitchOption {
	return func(c *SwitchTaskConfig) {
		// Support two patterns:
		// 1. Case(map[string]interface{}) - low-level
		// 2. Case(ConditionMatcher, "target") - high-level
		
		if caseMap, ok := conditionOrMap.(map[string]interface{}); ok {
			// Low-level map API
			c.Cases = append(c.Cases, caseMap)
		} else if matcher, ok := conditionOrMap.(ConditionMatcher); ok {
			// High-level typed API
			if len(target) == 0 {
				panic("Case with ConditionMatcher requires target task name")
			}
			caseMap := map[string]interface{}{
				"condition": matcher.Expression(),
				"then":      target[0],
			}
			c.Cases = append(c.Cases, caseMap)
		} else {
			// Treat as expression string
			if len(target) == 0 {
				panic("Case requires target task name")
			}
			caseMap := map[string]interface{}{
				"condition": coerceToString(conditionOrMap),
				"then":      target[0],
			}
			c.Cases = append(c.Cases, caseMap)
		}
	}
}

// DefaultCase sets the default task if no cases match.
//
// Example:
//
//	workflow.DefaultCase("handleDefault")
func DefaultCase(taskName string) SwitchOption {
	return func(c *SwitchTaskConfig) {
		c.DefaultTask = taskName
	}
}
