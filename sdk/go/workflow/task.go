package workflow

import (
	"fmt"
)

// TaskKind represents the type of workflow task.
type TaskKind string

// Task kinds matching Zigflow DSL task types.
const (
	TaskKindSet          TaskKind = "SET"
	TaskKindHttpCall     TaskKind = "HTTP_CALL"
	TaskKindGrpcCall     TaskKind = "GRPC_CALL"
	TaskKindSwitch       TaskKind = "SWITCH"
	TaskKindFor          TaskKind = "FOR"
	TaskKindFork         TaskKind = "FORK"
	TaskKindTry          TaskKind = "TRY"
	TaskKindListen       TaskKind = "LISTEN"
	TaskKindWait         TaskKind = "WAIT"
	TaskKindCallActivity TaskKind = "CALL_ACTIVITY"
	TaskKindRaise        TaskKind = "RAISE"
	TaskKindRun          TaskKind = "RUN"
	TaskKindAgentCall    TaskKind = "AGENT_CALL"
)

// Special task flow control constants.
const (
	// EndFlow indicates the workflow should terminate after this task.
	// Use task.End() method instead of task.Then(EndFlow) for better readability.
	EndFlow = "end"
)

// Task represents a single task in a workflow.
type Task struct {
	// Task name/identifier (must be unique within workflow)
	Name string

	// Task type (determines how to interpret Config)
	Kind TaskKind

	// Task-specific configuration (type depends on Kind)
	Config TaskConfig

	// Export configuration (how to save task output to context)
	ExportAs string

	// Flow control (which task executes next)
	ThenTask string

	// Explicit dependencies (optional, for cases where field references don't capture it)
	// This is tracked automatically when using TaskFieldRef but can be set explicitly
	Dependencies []string
}

// TaskConfig is a marker interface for task configurations.
type TaskConfig interface {
	isTaskConfig()
}

// ============================================================================
// TaskFieldRef - Typed references to task output fields (Pulumi-style)
// ============================================================================

// TaskFieldRef represents a typed reference to a specific field in a task's output.
// This enables Pulumi-style task output references where the origin is always clear.
//
// Example:
//
//	fetchTask := wf.HttpGet("fetch", apiURL)
//	title := fetchTask.Field("title")  // Clear: title comes from fetchTask!
//	processTask := wf.SetVars("process", "postTitle", title)
//
// This replaces magic string references:
//
//	workflow.FieldRef("title")  // ❌ Where does "title" come from? Unclear!
//	fetchTask.Field("title")    // ✅ Clear origin - from fetchTask
type TaskFieldRef struct {
	taskName  string // Name of the task this field comes from
	fieldName string // Name of the field in the task output
}

// Expression returns the JQ expression for this field reference.
// Implements the Ref interface.
func (r TaskFieldRef) Expression() string {
	// Use bracket notation for task name to support hyphens and special characters
	// Reference format: ${ $context["task-name"].fieldName }
	// This allows task names to contain hyphens without breaking jq parsing
	return fmt.Sprintf("${ $context[\"%s\"].%s }", r.taskName, r.fieldName)
}

// Name returns a human-readable name for this reference.
// Implements the Ref interface.
func (r TaskFieldRef) Name() string {
	return fmt.Sprintf("%s.%s", r.taskName, r.fieldName)
}

// TaskName returns the name of the source task.
// This is used for dependency tracking.
func (r TaskFieldRef) TaskName() string {
	return r.taskName
}

// FieldName returns the name of the field being referenced.
func (r TaskFieldRef) FieldName() string {
	return r.fieldName
}

// Field creates a typed reference to an output field of this task.
// This enables Pulumi-style output references with clear origins.
//
// **IMPORTANT: Auto-Export Behavior**
// Calling Field() automatically marks this task for export (sets ExportAs = "${.}").
// This matches Pulumi's pattern: accessing a task's output implies it should be exported.
// You don't need to manually call .ExportAll() - it happens automatically!
//
// Example:
//
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	title := fetchTask.Field("title")  // ✅ Auto-exports fetchTask!
//	body := fetchTask.Field("body")    // ✅ Already exported, no-op
//
//	processTask := wf.SetVars("process",
//	    "postTitle", title,
//	    "postBody", body,
//	)
//	// Dependencies are implicit - processTask depends on fetchTask!
//
// This replaces the old pattern:
//
//	workflow.FieldRef("title")  // ❌ Magic string - where's it from?
//	fetchTask.Field("title")    // ✅ Clear origin!
func (t *Task) Field(fieldName string) TaskFieldRef {
	// Auto-export: When a task's field is referenced, automatically export the task
	// This matches Pulumi's implicit dependency pattern where accessing an output
	// automatically makes it available in the workflow context.
	//
	// Only set export if not already set (avoid overwriting custom export configs)
	if t.ExportAs == "" {
		t.ExportAs = "${.}"
	}

	return TaskFieldRef{
		taskName:  t.Name,
		fieldName: fieldName,
	}
}

// DependsOn adds explicit dependencies to this task.
// This is the escape hatch for when implicit dependencies (through field references)
// don't capture the relationship. Like Pulumi's pulumi.DependsOn().
//
// In most cases, dependencies are inferred automatically when you use TaskFieldRef.
// Only use DependsOn() when:
//   - Side effects matter (task A must run before task B, but B doesn't use A's output)
//   - Ordering is important for reasons not captured by data flow
//
// Example:
//
//	// Implicit dependency (preferred):
//	processTask := wf.SetVars("process",
//	    "data", fetchTask.Field("body"),  // Automatic dependency!
//	)
//
//	// Explicit dependency (escape hatch):
//	cleanupTask := wf.SetVars("cleanup", ...)
//	cleanupTask.DependsOn(processTask)  // Cleanup must run after process
func (t *Task) DependsOn(tasks ...*Task) *Task {
	for _, task := range tasks {
		// Check if already in dependencies
		found := false
		for _, dep := range t.Dependencies {
			if dep == task.Name {
				found = true
				break
			}
		}
		if !found {
			t.Dependencies = append(t.Dependencies, task.Name)
		}
	}
	return t
}

// Export sets the export directive for this task using a low-level expression.
// For most use cases, prefer ExportAll() or ExportField() for better UX.
// Example: task.Export("${.}") exports entire output.
func (t *Task) Export(expr string) *Task {
	t.ExportAs = expr
	return t
}

// ExportAll exports the entire task output to the workflow context.
// This is a high-level helper that replaces Export("${.}").
// Example: HttpCallTask("fetch",...).ExportAll()
func (t *Task) ExportAll() *Task {
	t.ExportAs = "${.}"
	return t
}

// ExportField exports a specific field from the task output to the workflow context.
// This is a high-level helper that replaces Export("${.field}").
// Example: HttpCallTask("fetch",...).ExportField("count")
func (t *Task) ExportField(fieldName string) *Task {
	t.ExportAs = fmt.Sprintf("${ $context.%s }", fieldName)
	return t
}

// ExportFields exports multiple fields from the task output to the workflow context.
// Each field is exported with its original name.
// Example: HttpCallTask("fetch",...).ExportFields("count", "status", "data")
func (t *Task) ExportFields(fieldNames ...string) *Task {
	// For multiple fields, we export the whole object and let the next task
	// access specific fields. This is more efficient than creating separate exports.
	// In the future, we could support selective field export if the proto supports it.
	t.ExportAs = "${.}"
	return t
}

// Then sets the flow control directive for this task using a task name string.
// Example: task.Then("nextTask") jumps to task named "nextTask".
//
// For type-safe task references, use ThenRef() instead.
func (t *Task) Then(taskName string) *Task {
	t.ThenTask = taskName
	return t
}

// ThenRef sets the flow control directive using a task reference.
// This is type-safe and prevents typos in task names.
//
// Example:
//
//	task1 := workflow.SetTask("init", workflow.SetInt("x", 1))
//	task2 := workflow.HttpCallTask("fetch", ...).ThenRef(task1)
func (t *Task) ThenRef(task *Task) *Task {
	t.ThenTask = task.Name
	return t
}

// End terminates the workflow after this task.
// This is equivalent to task.Then(workflow.EndFlow) but more explicit.
func (t *Task) End() *Task {
	t.ThenTask = EndFlow
	return t
}
