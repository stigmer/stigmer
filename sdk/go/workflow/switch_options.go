package workflow

import "fmt"

// SwitchArgs is an alias for SwitchTaskConfig (Pulumi-style args pattern).
type SwitchArgs = SwitchTaskConfig

// Switch creates a SWITCH task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Switch("routeByType", &workflow.SwitchArgs{
//	    Cases: []map[string]interface{}{
//	        {
//	            "condition": "${.type == 'A'}",
//	            "then": "handleA",
//	        },
//	        {
//	            "condition": "${.type == 'B'}",
//	            "then": "handleB",
//	        },
//	    },
//	    DefaultTask: "handleDefault",
//	})
func Switch(name string, args *SwitchArgs) *Task {
	if args == nil {
		args = &SwitchArgs{}
	}

	// Initialize slices if nil
	if args.Cases == nil {
		args.Cases = []map[string]interface{}{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSwitch,
		Config: args,
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
//	workflow.Equals(200) // Use in case conditions
//	workflow.Equals("active")
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
//	workflow.GreaterThan(100)
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
//	workflow.LessThan(10)
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
//	workflow.CustomCondition("${.status == 'active' && .count > 10}")
func CustomCondition(expr string) ConditionMatcher {
	return &customMatcher{expr: expr}
}
