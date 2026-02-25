// tasks_control.go provides factory functions for control flow workflow tasks.
//
// This file consolidates task factories for control flow structures:
// FOR (loops), FORK (parallel execution), SWITCH (conditional branching),
// TRY (error handling), along with their helper types and functions.

package workflow

import (
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// =============================================================================
// Type Aliases (Pulumi-style Args pattern)
// =============================================================================

type (
	// ForArgs is an alias for ForTaskConfig.
	ForArgs = ForTaskConfig

	// ForkArgs is an alias for ForkTaskConfig.
	ForkArgs = ForkTaskConfig

	// SwitchArgs is an alias for SwitchTaskConfig.
	SwitchArgs = SwitchTaskConfig

	// TryArgs is an alias for TryTaskConfig.
	TryArgs = TryTaskConfig
)

// =============================================================================
// FOR Task (Loops)
// =============================================================================

// For creates a FOR task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.For("processItems", &workflow.ForArgs{
//	    Each: "item",
//	    In: "${.items}",
//	    Do: []*types.WorkflowTask{
//	        {Name: "process", Kind: "HTTP_CALL"},
//	    },
//	})
func For(name string, args *ForArgs) *Task {
	if args == nil {
		args = &ForArgs{}
	}

	// Initialize slices if nil
	if args.Do == nil {
		args.Do = []*types.WorkflowTask{}
	}

	// Set default Each variable name if not provided
	// This matches the default used by LoopBody
	if args.Each == "" {
		args.Each = "item"
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFor,
		Config: args,
	}
}

// LoopVar represents a loop variable that can be used in loop body.
// It provides a way to reference fields of the current iteration item.
type LoopVar struct {
	// varName is the implicit variable name for the current item
	varName string
}

// Field returns a reference to a field of the current loop item.
//
// Example:
//
//	item.Field("id") -> "${.item.id}"
//	item.Field("name") -> "${.item.name}"
func (v LoopVar) Field(fieldName string) string {
	if v.varName == "" {
		return "${.item." + fieldName + "}"
	}
	return "${." + v.varName + "." + fieldName + "}"
}

// Value returns a reference to the current item itself.
//
// Example:
//
//	item.Value() -> "${.item}"
func (v LoopVar) Value() string {
	if v.varName == "" {
		return "${.item}"
	}
	return "${." + v.varName + "}"
}

// LoopBody creates a typed loop body using a closure that receives the loop variable.
// This provides type-safe access to the current item without magic strings.
//
// The function creates a LoopVar representing the current iteration item (default: "item")
// and passes it to your closure. You build tasks using this LoopVar for field references.
//
// Example:
//
//	wf.ForEach("processItems", &workflow.ForArgs{
//	    In: fetchTask.Field("items"),
//	    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
//	        return []*workflow.Task{
//	            wf.HttpPost("processItem",
//	                apiBase.Concat("/process").Expression(),
//	                map[string]interface{}{
//	                    "itemId": item.Field("id"),      // Type-safe reference
//	                    "data":   item.Field("data"),    // No magic strings
//	                },
//	            ),
//	        }
//	    }),
//	})
func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask {
	// Create default loop variable (will use "item" unless Each field overrides)
	loopVar := LoopVar{varName: "item"}

	// Call user's function to get typed tasks
	tasks := fn(loopVar)

	// Convert SDK tasks to types.WorkflowTask format
	workflowTasks := make([]*types.WorkflowTask, 0, len(tasks))
	for _, task := range tasks {
		taskMap, err := taskToMap(task)
		if err != nil {
			// In production code, we might want to handle this differently
			// For now, we'll panic to surface the error during development
			panic(err)
		}

		wfTask := &types.WorkflowTask{
			Name: task.Name,
			Kind: task.Kind.String(),
		}

		if config, ok := taskMap["config"].(map[string]interface{}); ok {
			wfTask.TaskConfig = config
		}

		if exportMap, ok := taskMap["export"].(map[string]interface{}); ok {
			if asVal, ok := exportMap["as"].(string); ok {
				wfTask.Export = &types.Export{As: asVal}
			}
		}

		if thenVal, ok := taskMap["then"].(string); ok {
			wfTask.Flow = &types.FlowControl{Then: thenVal}
		}

		workflowTasks = append(workflowTasks, wfTask)
	}

	return workflowTasks
}

// =============================================================================
// FORK Task (Parallel Execution)
// =============================================================================

// Fork creates a FORK task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Fork("parallel", &workflow.ForkArgs{
//	    Branches: []*types.ForkBranch{
//	        {
//	            Name: "branchA",
//	            Do: []*types.WorkflowTask{{Name: "task1", Kind: "HTTP_CALL"}},
//	        },
//	        {
//	            Name: "branchB",
//	            Do: []*types.WorkflowTask{{Name: "task2", Kind: "HTTP_CALL"}},
//	        },
//	    },
//	})
func Fork(name string, args *ForkArgs) *Task {
	if args == nil {
		args = &ForkArgs{}
	}

	// Initialize slices if nil
	if args.Branches == nil {
		args.Branches = []*types.ForkBranch{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFork,
		Config: args,
	}
}

// BranchDef represents a branch definition for parallel execution.
type BranchDef struct {
	Name string
	Task *Task
}

// BranchResult represents a reference to a branch's result in a fork task.
type BranchResult struct {
	taskName   string
	branchName string
}

// NewBranchResult creates a new BranchResult reference.
func NewBranchResult(taskName, branchName string) BranchResult {
	return BranchResult{
		taskName:   taskName,
		branchName: branchName,
	}
}

// Field returns a reference to a field in the branch result.
//
// Example:
//
//	branchResult.Field("data") -> "${.forkTask.branches.branchName.data}"
func (b BranchResult) Field(fieldName string) string {
	return "${." + b.taskName + ".branches." + b.branchName + "." + fieldName + "}"
}

// Value returns a reference to the entire branch result.
//
// Example:
//
//	branchResult.Value() -> "${.forkTask.branches.branchName}"
func (b BranchResult) Value() string {
	return "${." + b.taskName + ".branches." + b.branchName + "}"
}

// Branch returns a reference to a specific branch's result.
//
// Example:
//
//	forkTask.Branch("fetchUsers").Field("data")
func (t *Task) Branch(branchName string) BranchResult {
	return NewBranchResult(t.Name, branchName)
}

// ForkBranch creates a single fork branch with a name and tasks to execute in parallel.
// Use with ForkBranches to build the branches array for Fork tasks.
//
// Example:
//
//	wf.Fork("parallelTasks", &workflow.ForkArgs{
//	    Branches: workflow.ForkBranches(
//	        workflow.ForkBranch("branch1",
//	            wf.HttpGet("fetch1", "https://api.example.com/endpoint1", nil),
//	        ),
//	        workflow.ForkBranch("branch2",
//	            wf.HttpGet("fetch2", "https://api.example.com/endpoint2", nil),
//	        ),
//	    ),
//	})
func ForkBranch(name string, tasks ...*Task) *types.ForkBranch {
	return &types.ForkBranch{
		Name: name,
		Do:   TryBody(tasks...), // Reuse TryBody for task conversion
	}
}

// ForkBranches combines multiple fork branches into a slice.
// This is a convenience function to build the Branches field for ForkArgs.
//
// Example:
//
//	Branches: workflow.ForkBranches(
//	    workflow.ForkBranch("fetchUsers", ...),
//	    workflow.ForkBranch("fetchPosts", ...),
//	)
func ForkBranches(branches ...*types.ForkBranch) []*types.ForkBranch {
	return branches
}

// =============================================================================
// SWITCH Task (Conditional Branching)
// =============================================================================

// Switch creates a SWITCH task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Switch("routeByType", &workflow.SwitchArgs{
//	    Cases: []*types.SwitchCase{
//	        {
//	            Name: "caseA",
//	            When: "${.type == 'A'}",
//	            Then: "handleA",
//	        },
//	        {
//	            Name: "caseB",
//	            When: "${.type == 'B'}",
//	            Then: "handleB",
//	        },
//	    },
//	})
func Switch(name string, args *SwitchArgs) *Task {
	if args == nil {
		args = &SwitchArgs{}
	}

	// Initialize slices if nil
	if args.Cases == nil {
		args.Cases = []*types.SwitchCase{}
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

// =============================================================================
// TRY Task (Error Handling)
// =============================================================================

// Try creates a TRY task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Try("handleErrors", &workflow.TryArgs{
//	    Try: []*types.WorkflowTask{
//	        {Name: "httpCall", Kind: "HTTP_CALL"},
//	    },
//	    Catch: &types.CatchBlock{
//	        As: "error",
//	        Do: []*types.WorkflowTask{
//	            {Name: "logError", Kind: "SET"},
//	        },
//	    },
//	})
func Try(name string, args *TryArgs) *Task {
	if args == nil {
		args = &TryArgs{}
	}

	// Initialize slices if nil
	if args.Try == nil {
		args.Try = []*types.WorkflowTask{}
	}
	// Catch is optional and can be nil

	return &Task{
		Name:   name,
		Kind:   TaskKindTry,
		Config: args,
	}
}

// ErrorRef represents an error that was caught in a try/catch block.
// It provides methods to access error information.
type ErrorRef struct {
	// varName is the variable name for the error
	varName string
}

// NewErrorRef creates a new ErrorRef with the given variable name.
func NewErrorRef(varName string) ErrorRef {
	if varName == "" {
		varName = "error"
	}
	return ErrorRef{varName: varName}
}

// Message returns a reference to the error message.
//
// Example:
//
//	err.Message() -> "${.error.message}"
func (e ErrorRef) Message() string {
	return "${." + e.varName + ".message}"
}

// Type returns a reference to the error type.
//
// Example:
//
//	err.Type() -> "${.error.type}"
func (e ErrorRef) Type() string {
	return "${." + e.varName + ".type}"
}

// Timestamp returns a reference to when the error occurred.
//
// Example:
//
//	err.Timestamp() -> "${.error.timestamp}"
func (e ErrorRef) Timestamp() string {
	return "${." + e.varName + ".timestamp}"
}

// StackTrace returns a reference to the error stack trace.
//
// Example:
//
//	err.StackTrace() -> "${.error.stackTrace}"
func (e ErrorRef) StackTrace() string {
	return "${." + e.varName + ".stackTrace}"
}

// Field returns a reference to a custom field in the error.
//
// Example:
//
//	err.Field("statusCode") -> "${.error.statusCode}"
func (e ErrorRef) Field(fieldName string) string {
	return "${." + e.varName + "." + fieldName + "}"
}

// TryBody converts SDK tasks to types.WorkflowTask format for use in TRY blocks.
// This enables type-safe task definitions within Try/Catch constructs.
//
// Example:
//
//	wf.Try("attemptAPICall", &workflow.TryArgs{
//	    Try: workflow.TryBody(
//	        wf.HttpGet("fetchData", "https://api.example.com/data", nil),
//	    ),
//	    Catch: workflow.CatchBody("error",
//	        wf.Set("handleError", &workflow.SetArgs{...}),
//	    ),
//	})
func TryBody(tasks ...*Task) []*types.WorkflowTask {
	workflowTasks := make([]*types.WorkflowTask, 0, len(tasks))
	for _, task := range tasks {
		taskMap, err := taskToMap(task)
		if err != nil {
			panic(err)
		}

		wfTask := &types.WorkflowTask{
			Name:       task.Name,
			Kind:       task.Kind.String(),
			TaskConfig: taskMap["config"].(map[string]interface{}),
		}

		// Extract export if present
		if exportMap, ok := taskMap["export"].(map[string]interface{}); ok {
			if asStr, ok := exportMap["as"].(string); ok {
				wfTask.Export = &types.Export{As: asStr}
			}
		}

		workflowTasks = append(workflowTasks, wfTask)
	}
	return workflowTasks
}

// CatchBody creates a catch block for error handling in TRY tasks.
// The errorVar parameter specifies the variable name to store the caught error.
//
// Example:
//
//	Catch: workflow.CatchBody("error",
//	    wf.Set("logError", &workflow.SetArgs{
//	        Variables: map[string]string{
//	            "message": "${.error.message}",
//	        },
//	    }),
//	)
func CatchBody(errorVar string, tasks ...*Task) *types.CatchBlock {
	return &types.CatchBlock{
		As: errorVar,
		Do: TryBody(tasks...),
	}
}
