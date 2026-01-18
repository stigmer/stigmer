package workflow

import (
	"fmt"
	"strings"
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
	// Reference format: ${ $context.taskName.fieldName }
	// This assumes the task has exported its output to context
	return fmt.Sprintf("${ $context.%s.%s }", r.taskName, r.fieldName)
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
//  - Side effects matter (task A must run before task B, but B doesn't use A's output)
//  - Ordering is important for reasons not captured by data flow
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
// For type-safe task references, use ThenTask() instead.
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

// ============================================================================
// SET Task
// ============================================================================

// SetTaskConfig defines the configuration for SET tasks.
type SetTaskConfig struct {
	// Variables to set in workflow state.
	// Keys are variable names, values can be literals or expressions.
	Variables map[string]string
	
	// ImplicitDependencies tracks task dependencies discovered through TaskFieldRef usage.
	// This is used during task creation to populate the task's Dependencies field.
	// Map key is the task name, value is always true (set semantics).
	ImplicitDependencies map[string]bool
}

func (*SetTaskConfig) isTaskConfig() {}

// SetTask creates a new SET task.
//
// SET tasks assign variables in workflow state.
//
// When using TaskFieldRef values, dependencies are automatically tracked:
//
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	processTask := workflow.SetTask("process",
//	    workflow.SetVar("title", fetchTask.Field("title")),  // Implicit dependency!
//	)
//
// Example:
//
//	task := workflow.SetTask("init",
//	    workflow.SetVar("apiURL", "https://api.example.com"),
//	    workflow.SetVar("count", "0"),
//	)
func SetTask(name string, opts ...SetTaskOption) *Task {
	cfg := &SetTaskConfig{
		Variables:            make(map[string]string),
		ImplicitDependencies: make(map[string]bool),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	// Create task
	task := &Task{
		Name:         name,
		Kind:         TaskKindSet,
		Config:       cfg,
		Dependencies: []string{},
	}

	// Propagate implicit dependencies to task
	for taskName := range cfg.ImplicitDependencies {
		task.Dependencies = append(task.Dependencies, taskName)
	}

	return task
}

// SetTaskOption is a functional option for configuring SET tasks.
type SetTaskOption func(*SetTaskConfig)

// SetVar adds a variable to a SET task.
// Accepts either a string or a Ref type for the value.
// For better type safety, consider using SetInt, SetString, SetBool instead.
//
// When a TaskFieldRef is used, the dependency is automatically tracked.
//
// Examples:
//
//	SetVar("apiURL", "https://api.example.com")     // Legacy string
//	SetVar("apiURL", ctx.SetString("url", "..."))   // Typed context
//	SetVar("endpoint", apiURL.Concat("/users"))     // StringRef transformation
//	SetVar("title", fetchTask.Field("title"))       // Implicit dependency on fetchTask!
func SetVar(key string, value interface{}) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		cfg.Variables[key] = toExpression(value)
		
		// Track implicit dependency if this is a TaskFieldRef
		if fieldRef, ok := value.(TaskFieldRef); ok {
			// Store dependency info in config for later tracking
			if cfg.ImplicitDependencies == nil {
				cfg.ImplicitDependencies = make(map[string]bool)
			}
			cfg.ImplicitDependencies[fieldRef.TaskName()] = true
		}
	}
}

// SetVars adds multiple variables to a SET task.
func SetVars(vars map[string]string) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		for k, v := range vars {
			cfg.Variables[k] = v
		}
	}
}

// SetInt adds an integer variable to a SET task with automatic type conversion.
// Accepts either an int or an IntRef from context.
// This is a high-level helper that provides better UX than SetVar("count", "0").
//
// Examples:
//
//	SetInt("count", 0)                          // Legacy int
//	SetInt("count", ctx.SetInt("retries", 3))   // Typed context
//	SetInt("count", counter.Add(1))             // IntRef transformation
func SetInt(key string, value interface{}) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		cfg.Variables[key] = toExpression(value)
	}
}

// SetString adds a string variable to a SET task.
// Accepts either a string or a StringRef from context.
// This is semantically clearer than SetVar for string values.
//
// Examples:
//
//	SetString("status", "pending")                      // Legacy string
//	SetString("status", ctx.SetString("state", "..."))  // Typed context
//	SetString("url", apiURL.Concat("/users"))           // StringRef transformation
func SetString(key string, value interface{}) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		cfg.Variables[key] = toExpression(value)
	}
}

// SetBool adds a boolean variable to a SET task with automatic type conversion.
// Accepts either a bool or a BoolRef from context.
//
// Examples:
//
//	SetBool("enabled", true)                       // Legacy bool
//	SetBool("enabled", ctx.SetBool("isProd", true)) // Typed context
func SetBool(key string, value interface{}) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		cfg.Variables[key] = toExpression(value)
	}
}

// SetFloat adds a float variable to a SET task with automatic type conversion.
// Accepts either a float or numeric value.
//
// Example:
//
//	SetFloat("price", 99.99)
func SetFloat(key string, value interface{}) SetTaskOption {
	return func(cfg *SetTaskConfig) {
		cfg.Variables[key] = toExpression(value)
	}
}

// ============================================================================
// HTTP_CALL Task
// ============================================================================

// HttpCallTaskConfig defines the configuration for HTTP_CALL tasks.
type HttpCallTaskConfig struct {
	Method         string            // HTTP method (GET, POST, PUT, DELETE, PATCH)
	URI            string            // HTTP endpoint URI
	Headers        map[string]string // HTTP headers
	Body           map[string]any    // Request body (JSON)
	TimeoutSeconds int32             // Request timeout in seconds
	
	// ImplicitDependencies tracks task dependencies discovered through TaskFieldRef usage.
	ImplicitDependencies map[string]bool
}

func (*HttpCallTaskConfig) isTaskConfig() {}

// HttpCallTask creates a new HTTP_CALL task.
//
// HTTP_CALL tasks make HTTP requests.
//
// Example:
//
//	task := workflow.HttpCallTask("fetchData",
//	    workflow.WithHTTPGet(),  // Type-safe HTTP method
//	    workflow.WithURI("https://api.example.com/data"),
//	    workflow.WithHeader("Authorization", "Bearer ${TOKEN}"),
//	)
func HttpCallTask(name string, opts ...HttpCallTaskOption) *Task {
	cfg := &HttpCallTaskConfig{
		Headers:              make(map[string]string),
		Body:                 make(map[string]any),
		TimeoutSeconds:       30, // default timeout
		ImplicitDependencies: make(map[string]bool),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	// Create task
	task := &Task{
		Name:         name,
		Kind:         TaskKindHttpCall,
		Config:       cfg,
		Dependencies: []string{},
	}

	// Propagate implicit dependencies to task
	for taskName := range cfg.ImplicitDependencies {
		task.Dependencies = append(task.Dependencies, taskName)
	}

	return task
}

// HttpCallTaskOption is a functional option for configuring HTTP_CALL tasks.
type HttpCallTaskOption func(*HttpCallTaskConfig)

// WithMethod sets the HTTP method using a string.
// For common HTTP methods, prefer using the type-safe helpers:
// WithHTTPGet(), WithHTTPPost(), WithHTTPPut(), WithHTTPPatch(), WithHTTPDelete(), etc.
// Use this function for custom or non-standard HTTP methods.
func WithMethod(method string) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = method
	}
}

// WithHTTPGet sets the HTTP method to GET.
// This is a type-safe helper for the most common HTTP method.
func WithHTTPGet() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "GET"
	}
}

// WithHTTPPost sets the HTTP method to POST.
// This is a type-safe helper for creating or submitting data.
func WithHTTPPost() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "POST"
	}
}

// WithHTTPPut sets the HTTP method to PUT.
// This is a type-safe helper for updating or replacing resources.
func WithHTTPPut() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "PUT"
	}
}

// WithHTTPPatch sets the HTTP method to PATCH.
// This is a type-safe helper for partial updates to resources.
func WithHTTPPatch() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "PATCH"
	}
}

// WithHTTPDelete sets the HTTP method to DELETE.
// This is a type-safe helper for removing resources.
func WithHTTPDelete() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "DELETE"
	}
}

// WithHTTPHead sets the HTTP method to HEAD.
// This is a type-safe helper for retrieving headers without body.
func WithHTTPHead() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "HEAD"
	}
}

// WithHTTPOptions sets the HTTP method to OPTIONS.
// This is a type-safe helper for retrieving allowed methods and CORS.
func WithHTTPOptions() HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Method = "OPTIONS"
	}
}

// WithURI sets the HTTP URI.
// Accepts either a string or a Ref type (e.g., StringRef from context, TaskFieldRef).
//
// When a TaskFieldRef is used, the dependency is automatically tracked.
//
// Examples:
//
//	WithURI("https://api.example.com")                     // Legacy string
//	WithURI(ctx.SetString("apiURL", "https://..."))        // Typed context
//	WithURI(apiURL.Concat("/users"))                       // StringRef transformation
//	WithURI(fetchTask.Field("nextURL"))                    // Implicit dependency on fetchTask!
func WithURI(uri interface{}) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.URI = toExpression(uri)
		
		// Track implicit dependency if this is a TaskFieldRef
		if fieldRef, ok := uri.(TaskFieldRef); ok {
			if cfg.ImplicitDependencies == nil {
				cfg.ImplicitDependencies = make(map[string]bool)
			}
			cfg.ImplicitDependencies[fieldRef.TaskName()] = true
		}
	}
}

// WithHeader adds an HTTP header.
// Accepts either strings or Ref types for both key and value.
//
// Examples:
//
//	WithHeader("Content-Type", "application/json")                // Legacy strings
//	WithHeader("Authorization", ctx.SetSecret("token", "..."))    // Secret ref
//	WithHeader("Authorization", token.Prepend("Bearer "))         // StringRef transformation
func WithHeader(key string, value interface{}) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Headers[key] = toExpression(value)
	}
}

// Header is a convenience alias for WithHeader for cleaner syntax.
// Use this in the new Pulumi-style builders for brevity.
//
// Example:
//
//	wf.HttpGet("fetch", endpoint,
//	    workflow.Header("Content-Type", "application/json"),  // Clean!
//	    workflow.Header("Authorization", token),
//	)
func Header(key string, value interface{}) HttpCallTaskOption {
	return WithHeader(key, value)
}

// WithHeaders adds multiple HTTP headers.
func WithHeaders(headers map[string]string) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		for k, v := range headers {
			cfg.Headers[k] = v
		}
	}
}

// WithBody sets the request body.
func WithBody(body map[string]any) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.Body = body
	}
}

// WithTimeout sets the request timeout in seconds.
// Accepts either an int or an IntRef from context.
//
// Examples:
//
//	WithTimeout(30)                                // Legacy int
//	WithTimeout(ctx.SetInt("timeout", 30))         // Typed context
func WithTimeout(seconds interface{}) HttpCallTaskOption {
	return func(cfg *HttpCallTaskConfig) {
		cfg.TimeoutSeconds = toInt32(seconds)
	}
}

// Timeout is a convenience alias for WithTimeout for cleaner syntax.
// Use this in the new Pulumi-style builders for brevity.
//
// Example:
//
//	wf.HttpGet("fetch", endpoint,
//	    workflow.Timeout(30),  // Clean!
//	)
func Timeout(seconds interface{}) HttpCallTaskOption {
	return WithTimeout(seconds)
}

// ============================================================================
// GRPC_CALL Task
// ============================================================================

// GrpcCallTaskConfig defines the configuration for GRPC_CALL tasks.
type GrpcCallTaskConfig struct {
	Service string         // gRPC service name
	Method  string         // gRPC method name
	Body    map[string]any // Request body (proto message as JSON)
}

func (*GrpcCallTaskConfig) isTaskConfig() {}

// GrpcCallTask creates a new GRPC_CALL task.
//
// Example:
//
//	task := workflow.GrpcCallTask("callService",
//	    workflow.WithService("UserService"),
//	    workflow.WithGrpcMethod("GetUser"),
//	    workflow.WithGrpcBody(map[string]any{"userId": "${.userId}"}),
//	)
func GrpcCallTask(name string, opts ...GrpcCallTaskOption) *Task {
	cfg := &GrpcCallTaskConfig{
		Body: make(map[string]any),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindGrpcCall,
		Config: cfg,
	}
}

// GrpcCallTaskOption is a functional option for configuring GRPC_CALL tasks.
type GrpcCallTaskOption func(*GrpcCallTaskConfig)

// WithService sets the gRPC service name.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithService("UserService")                        // Legacy string
//	WithService(ctx.SetString("service", "..."))      // Typed context
func WithService(service interface{}) GrpcCallTaskOption {
	return func(cfg *GrpcCallTaskConfig) {
		cfg.Service = toExpression(service)
	}
}

// WithGrpcMethod sets the gRPC method name.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithGrpcMethod("GetUser")                         // Legacy string
//	WithGrpcMethod(ctx.SetString("method", "..."))    // Typed context
func WithGrpcMethod(method interface{}) GrpcCallTaskOption {
	return func(cfg *GrpcCallTaskConfig) {
		cfg.Method = toExpression(method)
	}
}

// WithGrpcBody sets the gRPC request body.
func WithGrpcBody(body map[string]any) GrpcCallTaskOption {
	return func(cfg *GrpcCallTaskConfig) {
		cfg.Body = body
	}
}

// ============================================================================
// SWITCH Task
// ============================================================================

// SwitchTaskConfig defines the configuration for SWITCH tasks.
type SwitchTaskConfig struct {
	Cases       []SwitchCase // Conditional cases
	DefaultTask string       // Default task if no cases match
}

// SwitchCase represents a conditional case in a SWITCH task.
type SwitchCase struct {
	Condition string // Condition expression
	Then      string // Task to execute if condition is true
}

func (*SwitchTaskConfig) isTaskConfig() {}

// SwitchTask creates a new SWITCH task.
//
// Example:
//
//	task := workflow.SwitchTask("checkStatus",
//	    workflow.WithCase("${.status == 200}", "processSuccess"),
//	    workflow.WithCase("${.status == 404}", "handleNotFound"),
//	    workflow.WithDefault("handleError"),
//	)
func SwitchTask(name string, opts ...SwitchTaskOption) *Task {
	cfg := &SwitchTaskConfig{
		Cases: []SwitchCase{},
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSwitch,
		Config: cfg,
	}
}

// SwitchTaskOption is a functional option for configuring SWITCH tasks.
type SwitchTaskOption func(*SwitchTaskConfig)

// WithCase adds a conditional case using a task name string.
// For type-safe task references, use WithCaseRef instead.
// Example: WithCase("${.status == 200}", "handleSuccess")
func WithCase(condition, then string) SwitchTaskOption {
	return func(cfg *SwitchTaskConfig) {
		cfg.Cases = append(cfg.Cases, SwitchCase{
			Condition: condition,
			Then:      then,
		})
	}
}

// WithCaseRef adds a conditional case using a task reference.
// This is type-safe and prevents typos in task names.
// Example: WithCaseRef("${.status == 200}", successTask)
func WithCaseRef(condition string, task *Task) SwitchTaskOption {
	return func(cfg *SwitchTaskConfig) {
		cfg.Cases = append(cfg.Cases, SwitchCase{
			Condition: condition,
			Then:      task.Name,
		})
	}
}

// WithDefault sets the default task using a task name string.
// For type-safe task references, use WithDefaultRef instead.
// Example: WithDefault("handleError")
func WithDefault(task string) SwitchTaskOption {
	return func(cfg *SwitchTaskConfig) {
		cfg.DefaultTask = task
	}
}

// WithDefaultRef sets the default task using a task reference.
// This is type-safe and prevents typos in task names.
// Example: WithDefaultRef(errorTask)
func WithDefaultRef(task *Task) SwitchTaskOption {
	return func(cfg *SwitchTaskConfig) {
		cfg.DefaultTask = task.Name
	}
}

// ============================================================================
// FOR Task
// ============================================================================

// ForTaskConfig defines the configuration for FOR tasks.
type ForTaskConfig struct {
	In string  // Collection expression to iterate over
	Do []Task  // Tasks to execute for each item
}

func (*ForTaskConfig) isTaskConfig() {}

// ForTask creates a new FOR task.
//
// Example:
//
//	task := workflow.ForTask("processItems",
//	    workflow.WithIn("${.items}"),
//	    workflow.WithDo(
//	        workflow.SetTask("process", workflow.SetVar("item", "${.}")),
//	    ),
//	)
func ForTask(name string, opts ...ForTaskOption) *Task {
	cfg := &ForTaskConfig{
		Do: []Task{},
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFor,
		Config: cfg,
	}
}

// ForTaskOption is a functional option for configuring FOR tasks.
type ForTaskOption func(*ForTaskConfig)

// WithIn sets the collection expression.
// Accepts either a string expression or a Ref from context.
//
// Examples:
//
//	WithIn("${.items}")                              // Legacy expression
//	WithIn(ctx.SetObject("items", [...]))            // Typed context
func WithIn(expr interface{}) ForTaskOption {
	return func(cfg *ForTaskConfig) {
		cfg.In = toExpression(expr)
	}
}

// WithDo adds tasks to execute for each item.
func WithDo(tasks ...*Task) ForTaskOption {
	return func(cfg *ForTaskConfig) {
		for _, t := range tasks {
			cfg.Do = append(cfg.Do, *t)
		}
	}
}

// ============================================================================
// FORK Task
// ============================================================================

// ForkTaskConfig defines the configuration for FORK tasks.
type ForkTaskConfig struct {
	Branches []ForkBranch // Parallel branches to execute
}

// ForkBranch represents a parallel branch in a FORK task.
type ForkBranch struct {
	Name  string // Branch name
	Tasks []Task // Tasks to execute in this branch
}

func (*ForkTaskConfig) isTaskConfig() {}

// ForkTask creates a new FORK task.
//
// Example:
//
//	task := workflow.ForkTask("parallelProcessing",
//	    workflow.WithBranch("branch1",
//	        workflow.SetTask("task1", workflow.SetVar("x", "1")),
//	    ),
//	    workflow.WithBranch("branch2",
//	        workflow.SetTask("task2", workflow.SetVar("y", "2")),
//	    ),
//	)
func ForkTask(name string, opts ...ForkTaskOption) *Task {
	cfg := &ForkTaskConfig{
		Branches: []ForkBranch{},
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFork,
		Config: cfg,
	}
}

// ForkTaskOption is a functional option for configuring FORK tasks.
type ForkTaskOption func(*ForkTaskConfig)

// WithBranch adds a parallel branch.
func WithBranch(name string, tasks ...*Task) ForkTaskOption {
	return func(cfg *ForkTaskConfig) {
		branch := ForkBranch{
			Name:  name,
			Tasks: []Task{},
		}
		for _, t := range tasks {
			branch.Tasks = append(branch.Tasks, *t)
		}
		cfg.Branches = append(cfg.Branches, branch)
	}
}

// ============================================================================
// TRY Task
// ============================================================================

// TryTaskConfig defines the configuration for TRY tasks.
type TryTaskConfig struct {
	Tasks []Task       // Tasks to try
	Catch []CatchBlock // Error handlers
}

// CatchBlock represents an error handler in a TRY task.
type CatchBlock struct {
	Errors []string // Error types to catch
	As     string   // Variable name to bind error to
	Tasks  []Task   // Tasks to execute on error
}

func (*TryTaskConfig) isTaskConfig() {}

// TryTask creates a new TRY task.
//
// Example:
//
//	task := workflow.TryTask("handleErrors",
//	    workflow.WithTry(
//	        workflow.HttpCallTask("risky", workflow.WithHTTPGet(), workflow.WithURI("${.url}")),
//	    ),
//	    workflow.WithCatch([]string{"NetworkError"}, "err",
//	        workflow.SetTask("logError", workflow.SetVar("error", "${err}")),
//	    ),
//	)
func TryTask(name string, opts ...TryTaskOption) *Task {
	cfg := &TryTaskConfig{
		Tasks: []Task{},
		Catch: []CatchBlock{},
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindTry,
		Config: cfg,
	}
}

// TryTaskOption is a functional option for configuring TRY tasks.
type TryTaskOption func(*TryTaskConfig)

// WithTry adds tasks to try.
func WithTry(tasks ...*Task) TryTaskOption {
	return func(cfg *TryTaskConfig) {
		for _, t := range tasks {
			cfg.Tasks = append(cfg.Tasks, *t)
		}
	}
}

// WithCatch adds an error handler.
func WithCatch(errors []string, as string, tasks ...*Task) TryTaskOption {
	return func(cfg *TryTaskConfig) {
		catchBlock := CatchBlock{
			Errors: errors,
			As:     as,
			Tasks:  []Task{},
		}
		for _, t := range tasks {
			catchBlock.Tasks = append(catchBlock.Tasks, *t)
		}
		cfg.Catch = append(cfg.Catch, catchBlock)
	}
}

// ============================================================================
// LISTEN Task
// ============================================================================

// ListenTaskConfig defines the configuration for LISTEN tasks.
type ListenTaskConfig struct {
	Event string // Event name to listen for
}

func (*ListenTaskConfig) isTaskConfig() {}

// ListenTask creates a new LISTEN task.
//
// Example:
//
//	task := workflow.ListenTask("waitForApproval",
//	    workflow.WithEvent("approval.granted"),
//	)
func ListenTask(name string, opts ...ListenTaskOption) *Task {
	cfg := &ListenTaskConfig{}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindListen,
		Config: cfg,
	}
}

// ListenTaskOption is a functional option for configuring LISTEN tasks.
type ListenTaskOption func(*ListenTaskConfig)

// WithEvent sets the event to listen for.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithEvent("approval.granted")                        // Legacy string
//	WithEvent(ctx.SetString("eventName", "..."))         // Typed context
func WithEvent(event interface{}) ListenTaskOption {
	return func(cfg *ListenTaskConfig) {
		cfg.Event = toExpression(event)
	}
}

// ============================================================================
// WAIT Task
// ============================================================================

// WaitTaskConfig defines the configuration for WAIT tasks.
type WaitTaskConfig struct {
	Duration string // Duration to wait (e.g., "5s", "1m", "1h")
}

func (*WaitTaskConfig) isTaskConfig() {}

// WaitTask creates a new WAIT task.
//
// Example:
//
//	task := workflow.WaitTask("delay",
//	    workflow.WithDuration("5s"),
//	)
func WaitTask(name string, opts ...WaitTaskOption) *Task {
	cfg := &WaitTaskConfig{}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindWait,
		Config: cfg,
	}
}

// WaitTaskOption is a functional option for configuring WAIT tasks.
type WaitTaskOption func(*WaitTaskConfig)

// WithDuration sets the wait duration.
// Accepts string format, duration helpers, or Ref types.
//
// String format examples: "5s", "1m", "1h", "1d"
//
// Examples:
//
//	workflow.WithDuration(workflow.Seconds(5))              // Type-safe helper
//	workflow.WithDuration(workflow.Minutes(30))             // Discoverable
//	workflow.WithDuration("5s")                             // Legacy string
//	workflow.WithDuration(ctx.SetString("wait", "10s"))     // Typed context
func WithDuration(duration interface{}) WaitTaskOption {
	return func(cfg *WaitTaskConfig) {
		cfg.Duration = toExpression(duration)
	}
}

// ============================================================================
// Duration Builders - Type-safe helpers for time durations
// ============================================================================

// Seconds creates a duration string for the specified number of seconds.
// This is a type-safe helper that replaces manual "Xs" string formatting.
//
// Example:
//
//	workflow.WaitTask("delay",
//	    workflow.WithDuration(workflow.Seconds(5)),  // ✅ Type-safe!
//	)
//
// This replaces the old string-based syntax:
//
//	WithDuration("5s")  // ❌ Not type-safe, typo-prone
//	WithDuration(Seconds(5))  // ✅ Type-safe, discoverable
func Seconds(count int) string {
	return fmt.Sprintf("%ds", count)
}

// Minutes creates a duration string for the specified number of minutes.
// This is a type-safe helper that replaces manual "Xm" string formatting.
//
// Example:
//
//	workflow.WaitTask("delay",
//	    workflow.WithDuration(workflow.Minutes(5)),
//	)
//
// Common use cases:
//   - Polling intervals
//   - Retry delays
//   - Timeout configurations
//   - Rate limiting windows
func Minutes(count int) string {
	return fmt.Sprintf("%dm", count)
}

// Hours creates a duration string for the specified number of hours.
// This is a type-safe helper that replaces manual "Xh" string formatting.
//
// Example:
//
//	workflow.WaitTask("delay",
//	    workflow.WithDuration(workflow.Hours(2)),
//	)
//
// Common use cases:
//   - Long-running batch jobs
//   - Scheduled task delays
//   - Cache expiration
//   - Token validity periods
func Hours(count int) string {
	return fmt.Sprintf("%dh", count)
}

// Days creates a duration string for the specified number of days.
// This is a type-safe helper that replaces manual "Xd" string formatting.
//
// Example:
//
//	workflow.WaitTask("delay",
//	    workflow.WithDuration(workflow.Days(7)),
//	)
//
// Common use cases:
//   - Weekly scheduled tasks
//   - Retention periods
//   - Subscription renewals
//   - Long-term delays
func Days(count int) string {
	return fmt.Sprintf("%dd", count)
}

// ============================================================================
// CALL_ACTIVITY Task
// ============================================================================

// CallActivityTaskConfig defines the configuration for CALL_ACTIVITY tasks.
type CallActivityTaskConfig struct {
	Activity string         // Activity name
	Input    map[string]any // Activity input
}

func (*CallActivityTaskConfig) isTaskConfig() {}

// CallActivityTask creates a new CALL_ACTIVITY task.
//
// Example:
//
//	task := workflow.CallActivityTask("processData",
//	    workflow.WithActivity("DataProcessor"),
//	    workflow.WithActivityInput(map[string]any{"data": "${.data}"}),
//	)
func CallActivityTask(name string, opts ...CallActivityTaskOption) *Task {
	cfg := &CallActivityTaskConfig{
		Input: make(map[string]any),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindCallActivity,
		Config: cfg,
	}
}

// CallActivityTaskOption is a functional option for configuring CALL_ACTIVITY tasks.
type CallActivityTaskOption func(*CallActivityTaskConfig)

// WithActivity sets the activity name.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithActivity("DataProcessor")                        // Legacy string
//	WithActivity(ctx.SetString("activity", "..."))       // Typed context
func WithActivity(activity interface{}) CallActivityTaskOption {
	return func(cfg *CallActivityTaskConfig) {
		cfg.Activity = toExpression(activity)
	}
}

// WithActivityInput sets the activity input.
func WithActivityInput(input map[string]any) CallActivityTaskOption {
	return func(cfg *CallActivityTaskConfig) {
		cfg.Input = input
	}
}

// ============================================================================
// RAISE Task
// ============================================================================

// RaiseTaskConfig defines the configuration for RAISE tasks.
type RaiseTaskConfig struct {
	Error   string         // Error type/name
	Message string         // Error message
	Data    map[string]any // Additional error data
}

func (*RaiseTaskConfig) isTaskConfig() {}

// RaiseTask creates a new RAISE task.
//
// Example:
//
//	task := workflow.RaiseTask("throwError",
//	    workflow.WithError("ValidationError"),
//	    workflow.WithErrorMessage("Invalid input data"),
//	)
func RaiseTask(name string, opts ...RaiseTaskOption) *Task {
	cfg := &RaiseTaskConfig{
		Data: make(map[string]any),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRaise,
		Config: cfg,
	}
}

// RaiseTaskOption is a functional option for configuring RAISE tasks.
type RaiseTaskOption func(*RaiseTaskConfig)

// WithError sets the error type.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithError("ValidationError")                         // Legacy string
//	WithError(ctx.SetString("errorType", "..."))         // Typed context
func WithError(errorType interface{}) RaiseTaskOption {
	return func(cfg *RaiseTaskConfig) {
		cfg.Error = toExpression(errorType)
	}
}

// WithErrorMessage sets the error message.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithErrorMessage("Invalid input")                    // Legacy string
//	WithErrorMessage(ctx.SetString("errMsg", "..."))     // Typed context
func WithErrorMessage(message interface{}) RaiseTaskOption {
	return func(cfg *RaiseTaskConfig) {
		cfg.Message = toExpression(message)
	}
}

// WithErrorData sets additional error data.
func WithErrorData(data map[string]any) RaiseTaskOption {
	return func(cfg *RaiseTaskConfig) {
		cfg.Data = data
	}
}

// ============================================================================
// RUN Task
// ============================================================================

// RunTaskConfig defines the configuration for RUN tasks.
type RunTaskConfig struct {
	WorkflowName string         // Sub-workflow name
	Input        map[string]any // Sub-workflow input
}

func (*RunTaskConfig) isTaskConfig() {}

// RunTask creates a new RUN task.
//
// Example:
//
//	task := workflow.RunTask("executeSubWorkflow",
//	    workflow.WithWorkflow("data-processor"),
//	    workflow.WithWorkflowInput(map[string]any{"data": "${.data}"}),
//	)
func RunTask(name string, opts ...RunTaskOption) *Task {
	cfg := &RunTaskConfig{
		Input: make(map[string]any),
	}

	for _, opt := range opts {
		opt(cfg)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRun,
		Config: cfg,
	}
}

// RunTaskOption is a functional option for configuring RUN tasks.
type RunTaskOption func(*RunTaskConfig)

// WithWorkflow sets the sub-workflow name.
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	WithWorkflow("data-processor")                       // Legacy string
//	WithWorkflow(ctx.SetString("workflow", "..."))       // Typed context
func WithWorkflow(workflow interface{}) RunTaskOption {
	return func(cfg *RunTaskConfig) {
		cfg.WorkflowName = toExpression(workflow)
	}
}

// WithWorkflowInput sets the sub-workflow input.
func WithWorkflowInput(input map[string]any) RunTaskOption {
	return func(cfg *RunTaskConfig) {
		cfg.Input = input
	}
}

// ============================================================================
// Variable Interpolation Helpers
// ============================================================================

// VarRef creates a reference to a workflow variable from context.
// Variables set via SetTask are stored in the workflow context and must be
// referenced using $context in JQ expressions.
//
// Example: WithURI(Interpolate(VarRef("apiURL"), "/data"))
// Generates: ${ $context.apiURL + "/data" }
//
// Note: This is for variables set in the workflow (via set: tasks).
// For environment variables, use a different helper (future).
func VarRef(varName string) string {
	return fmt.Sprintf("${ $context.%s }", varName)
}

// FieldRef creates a reference to a field in the current context.
// This is a high-level helper that replaces manual "${.field}" syntax.
// Example: SetVar("count", FieldRef("count")) instead of SetVar("count", "${ $context.count }")
func FieldRef(fieldPath string) string {
	return fmt.Sprintf("${ $context.%s }", fieldPath)
}

// Interpolate combines static text with variable references into a valid expression.
// 
// When mixing expressions (${ ... }) with static strings, this creates a proper
// JQ expression using concatenation syntax.
//
// Accepts strings, TaskFieldRef, or any type that has Expression() method.
//
// Examples:
//   - Interpolate(VarRef("apiURL"), "/data") 
//     → ${ $context.apiURL + "/data" } ✅
//   - Interpolate("Bearer ", VarRef("token"))
//     → ${ "Bearer " + $context.token } ✅
//   - Interpolate("https://", VarRef("domain"), "/api/v1")
//     → ${ "https://" + $context.domain + "/api/v1" } ✅
//   - Interpolate("Error: ", task.Field("error"))
//     → ${ "Error: " + $context.task.error } ✅
//
// Special cases:
//   - Interpolate(VarRef("url")) → ${ $context.url } (single expression, no concatenation)
//   - Interpolate("https://api.example.com") → https://api.example.com (plain string)
func Interpolate(parts ...interface{}) string {
	if len(parts) == 0 {
		return ""
	}
	
	// Convert all parts to strings
	// Handle TaskFieldRef, strings, and other types
	stringParts := make([]string, len(parts))
	for i, part := range parts {
		switch v := part.(type) {
		case string:
			stringParts[i] = v
		case TaskFieldRef:
			// Convert TaskFieldRef to its expression
			stringParts[i] = v.Expression()
		default:
			// For other types, use fmt.Sprintf
			stringParts[i] = fmt.Sprintf("%v", v)
		}
	}
	
	// Single part - return as-is
	if len(stringParts) == 1 {
		return stringParts[0]
	}
	
	// Check if any part contains an expression (starts with ${)
	hasExpression := false
	for _, part := range stringParts {
		if strings.HasPrefix(part, "${") {
			hasExpression = true
			break
		}
	}
	
	// If no expressions, just concatenate as plain string
	if !hasExpression {
		return strings.Join(stringParts, "")
	}
	
	// Build expression with proper concatenation
	exprParts := make([]string, 0, len(stringParts))
	for _, part := range stringParts {
		if strings.HasPrefix(part, "${") && strings.HasSuffix(part, "}") {
			// Extract expression content (remove ${ and })
			// Handle both formats: "${...}" and "${ ... }" (with spaces)
			expr := strings.TrimSpace(part[2 : len(part)-1])
			exprParts = append(exprParts, expr)
		} else {
			// Quote static strings
			exprParts = append(exprParts, fmt.Sprintf("\"%s\"", part))
		}
	}
	
	// Join with + operator and wrap in ${ }
	return fmt.Sprintf("${ %s }", strings.Join(exprParts, " + "))
}

// ============================================================================
// Error Field Accessors - Type-safe helpers for accessing caught error fields
// ============================================================================

// ErrorMessage returns a reference to the message field of a caught error.
// This is a type-safe helper that replaces manual "${ .errorVar.message }" syntax.
//
// When an error is caught in a CATCH block with `as: "errorVar"`, the error object
// contains several fields. ErrorMessage() provides a discoverable way to access
// the human-readable error description.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchHTTPErrors(),
//	    "httpErr",
//	    workflow.SetTask("handleError",
//	        workflow.SetVar("errorMessage", workflow.ErrorMessage("httpErr")),
//	    ),
//	)
//
// This replaces the old string-based syntax:
//
//	SetVar("errorMessage", "${ .httpErr.message }")  // ❌ Old way - not discoverable
//	SetVar("errorMessage", ErrorMessage("httpErr")) // ✅ New way - type-safe
func ErrorMessage(errorVar string) string {
	return fmt.Sprintf("${ .%s.message }", errorVar)
}

// ErrorCode returns a reference to the code field of a caught error.
// This is a type-safe helper that replaces manual "${ .errorVar.code }" syntax.
//
// The error code is a machine-readable string that indicates the error type.
// This is useful for logging or conditional logic based on error types.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchAny(),
//	    "err",
//	    workflow.SetTask("logError",
//	        workflow.SetVar("errorCode", workflow.ErrorCode("err")),
//	    ),
//	)
//
// This replaces the old string-based syntax:
//
//	SetVar("errorCode", "${ .err.code }")  // ❌ Old way - not discoverable
//	SetVar("errorCode", ErrorCode("err")) // ✅ New way - type-safe
func ErrorCode(errorVar string) string {
	return fmt.Sprintf("${ .%s.code }", errorVar)
}

// ErrorStackTrace returns a reference to the stackTrace field of a caught error.
// This is a type-safe helper that replaces manual "${ .errorVar.stackTrace }" syntax.
//
// The stack trace provides debugging information about where the error occurred.
// This is optional and may not be present for all error types.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchAny(),
//	    "err",
//	    workflow.SetTask("logError",
//	        workflow.SetVar("errorStackTrace", workflow.ErrorStackTrace("err")),
//	    ),
//	)
//
// This replaces the old string-based syntax:
//
//	SetVar("errorStackTrace", "${ .err.stackTrace }")  // ❌ Old way - not discoverable
//	SetVar("errorStackTrace", ErrorStackTrace("err")) // ✅ New way - type-safe
func ErrorStackTrace(errorVar string) string {
	return fmt.Sprintf("${ .%s.stackTrace }", errorVar)
}

// ErrorObject returns a reference to the entire caught error object.
// This is a type-safe helper that replaces manual "${ .errorVar }" syntax.
//
// Use this when you want to pass the entire error object (with all fields)
// to another task, such as logging or external error tracking services.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchAny(),
//	    "err",
//	    workflow.HttpCallTask("reportError",
//	        workflow.WithHTTPPost(),
//	        workflow.WithURI("https://api.example.com/errors"),
//	        workflow.WithBody(map[string]any{
//	            "error": workflow.ErrorObject("err"), // Pass entire error
//	            "workflow": "data-pipeline",
//	        }),
//	    ),
//	)
//
// This replaces the old string-based syntax:
//
//	"error": "${ .err }"  // ❌ Old way - not discoverable
//	"error": ErrorObject("err") // ✅ New way - type-safe
func ErrorObject(errorVar string) string {
	return fmt.Sprintf("${ .%s }", errorVar)
}

// ============================================================================
// Arithmetic Expression Builders - Common patterns for computed values
// ============================================================================

// Increment returns an expression that adds 1 to a context variable.
// This is a high-level helper for the extremely common pattern of incrementing counters.
//
// Use this for retry counters, iteration counts, and other increment scenarios.
//
// Example:
//
//	workflow.SetTask("retry",
//	    workflow.SetVar("retryCount", workflow.Increment("retryCount")),
//	)
//
// This replaces the old string-based syntax:
//
//	SetVar("retryCount", "${ $context.retryCount + 1 }")  // ❌ Old way - not discoverable
//	SetVar("retryCount", Increment("retryCount")) // ✅ New way - type-safe
//
// Common use cases:
//   - Retry counters in error handling
//   - Loop iteration counters
//   - Attempt tracking
//   - Step numbering
func Increment(varName string) string {
	return fmt.Sprintf("${ $context.%s + 1 }", varName)
}

// Decrement returns an expression that subtracts 1 from a context variable.
// This is a high-level helper for the common pattern of decrementing counters.
//
// Use this for countdown timers, remaining items, and other decrement scenarios.
//
// Example:
//
//	workflow.SetTask("processItem",
//	    workflow.SetVar("remaining", workflow.Decrement("remaining")),
//	)
//
// This replaces the old string-based syntax:
//
//	SetVar("remaining", "${ $context.remaining - 1 }")  // ❌ Old way - not discoverable
//	SetVar("remaining", Decrement("remaining")) // ✅ New way - type-safe
//
// Common use cases:
//   - Countdown timers
//   - Remaining items tracking
//   - Capacity tracking
//   - Quota management
func Decrement(varName string) string {
	return fmt.Sprintf("${ $context.%s - 1 }", varName)
}

// Expr provides an escape hatch for complex expressions that don't have dedicated helpers.
// Use this when you need arithmetic, string concatenation, or other computations
// that aren't covered by simple helpers like Increment() or Decrement().
//
// This is the "progressive disclosure" pattern - simple things use helpers,
// complex things use expressions directly.
//
// Note: When referencing context variables, use $context prefix in your expression.
//
// Example:
//
//	// Complex arithmetic with context variables
//	workflow.SetVar("total", workflow.Expr("($context.price * $context.quantity) + $context.tax"))
//
//	// String concatenation with context variables
//	workflow.SetVar("fullName", workflow.Expr("$context.firstName + ' ' + $context.lastName"))
//
//	// Accessing response fields (use . prefix)
//	workflow.SetVar("statusCode", workflow.Expr(".response.status"))
//
// Note: For simple cases, prefer dedicated helpers:
//   - Use Increment("x") instead of Expr("$context.x + 1")
//   - Use VarRef("name") instead of Expr("$context.name") for simple references
//   - Use ErrorMessage("err") instead of Expr("err.message") for error fields
func Expr(expression string) string {
	return fmt.Sprintf("${ %s }", expression)
}

// ============================================================================
// Condition Builders - High-level helpers for building conditional expressions
// ============================================================================

// Field returns a field reference expression (without ${} wrapper) for use in conditions.
// This is specifically for condition builders. For variable interpolation, use FieldRef().
// Example: Field("status") returns ".status"
func Field(fieldPath string) string {
	return fmt.Sprintf(".%s", fieldPath)
}

// Var returns a context variable reference expression (without ${} wrapper) for use in conditions.
// This is specifically for condition builders. For variable interpolation, use VarRef().
// Example: Var("apiURL") returns "$context.apiURL"
func Var(varName string) string {
	return fmt.Sprintf("$context.%s", varName)
}

// Literal returns a literal value wrapped in quotes for use in conditions.
// Example: Literal("200") returns "\"200\""
func Literal(value string) string {
	return fmt.Sprintf("\"%s\"", value)
}

// Number returns a numeric literal for use in conditions (no quotes).
// Example: Number(200) returns "200"
func Number(value interface{}) string {
	return fmt.Sprintf("%v", value)
}

// Equals builds an equality condition expression.
// Example: Equals(Field("status"), Number(200)) generates "${ .status == 200 }"
func Equals(left, right string) string {
	return fmt.Sprintf("${ %s == %s }", left, right)
}

// NotEquals builds an inequality condition expression.
// Example: NotEquals(Field("status"), Number(200)) generates "${ .status != 200 }"
func NotEquals(left, right string) string {
	return fmt.Sprintf("${ %s != %s }", left, right)
}

// GreaterThan builds a greater-than condition expression.
// Example: GreaterThan(Field("count"), Number(10)) generates "${ .count > 10 }"
func GreaterThan(left, right string) string {
	return fmt.Sprintf("${ %s > %s }", left, right)
}

// GreaterThanOrEqual builds a greater-than-or-equal condition expression.
// Example: GreaterThanOrEqual(Field("status"), Number(500)) generates "${ .status >= 500 }"
func GreaterThanOrEqual(left, right string) string {
	return fmt.Sprintf("${ %s >= %s }", left, right)
}

// LessThan builds a less-than condition expression.
// Example: LessThan(Field("count"), Number(100)) generates "${ .count < 100 }"
func LessThan(left, right string) string {
	return fmt.Sprintf("${ %s < %s }", left, right)
}

// LessThanOrEqual builds a less-than-or-equal condition expression.
// Example: LessThanOrEqual(Field("count"), Number(100)) generates "${ .count <= 100 }"
func LessThanOrEqual(left, right string) string {
	return fmt.Sprintf("${ %s <= %s }", left, right)
}

// And combines multiple conditions with logical AND.
// Example: And(Equals(Field("status"), Number(200)), Equals(Field("type"), Literal("success")))
func And(conditions ...string) string {
	// Remove ${ and } wrappers from conditions for proper nesting
	unwrapped := make([]string, len(conditions))
	for i, cond := range conditions {
		unwrapped[i] = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(strings.TrimSpace(cond), "}"), "${"))
	}
	return fmt.Sprintf("${ %s }", strings.Join(unwrapped, " && "))
}

// Or combines multiple conditions with logical OR.
// Example: Or(Equals(Field("status"), Number(200)), Equals(Field("status"), Number(201)))
func Or(conditions ...string) string {
	// Remove ${ and } wrappers from conditions for proper nesting
	unwrapped := make([]string, len(conditions))
	for i, cond := range conditions {
		unwrapped[i] = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(strings.TrimSpace(cond), "}"), "${"))
	}
	return fmt.Sprintf("${ %s }", strings.Join(unwrapped, " || "))
}

// Not negates a condition.
// Example: Not(Equals(Field("status"), Number(200))) generates "${ !(.status == 200) }"
func Not(condition string) string {
	// Remove ${ and } wrapper from condition for proper nesting
	unwrapped := strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(strings.TrimSpace(condition), "}"), "${"))
	return fmt.Sprintf("${ !(%s) }", unwrapped)
}
