package workflow

import (
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

// Context is a minimal interface that represents a stigmer context.
// This allows the workflow package to work with contexts without importing
// the stigmer package (avoiding import cycles).
//
// The stigmer.Context type implements this interface.
type Context interface {
	RegisterWorkflow(*Workflow)
}

// Workflow represents a workflow orchestration definition.
//
// Workflows are orchestration definitions that execute a series of tasks sequentially
// or in parallel. They support various task types including HTTP calls, gRPC calls,
// conditional logic, loops, error handling, and more.
//
// Use workflow.New() with stigmer.Run() to create a workflow:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    wf, err := workflow.New(ctx,
//	        workflow.WithNamespace("my-org"),
//	        workflow.WithName("data-pipeline"),
//	        workflow.WithVersion("1.0.0"),
//	        workflow.WithDescription("Process data from external API"),
//	    )
//	    return err
//	})
type Workflow struct {
	// Workflow metadata (namespace, name, version, description)
	Document Document

	// Slug is the URL-friendly identifier (auto-generated from name if not provided)
	Slug string

	// Human-readable description for UI and marketplace display
	Description string

	// Ordered list of tasks that make up this workflow
	Tasks []*Task

	// Environment variables required by the workflow
	EnvironmentVariables []environment.Variable

	// Organization that owns this workflow (optional)
	Org string

	// Context reference (optional, used for typed variable management)
	ctx Context
}

// Option is a functional option for configuring a Workflow.
type Option func(*Workflow) error

// New creates a new Workflow with a typed context for variable management.
//
// The workflow is automatically registered with the provided context for synthesis.
//
// Required options:
//   - WithNamespace: workflow namespace
//   - WithName: workflow name (or WithSlug for custom slug)
//
// Optional (with defaults):
//   - WithVersion: workflow version (defaults to "0.1.0" if not provided)
//   - WithDescription: human-readable description
//   - WithOrg: organization identifier
//   - WithSlug: custom slug (overrides auto-generation from name)
//
// Example:
//
//	stigmer.Run(func(ctx *stigmer.Context) error {
//	    wf, err := workflow.New(ctx,
//	        workflow.WithNamespace("data-processing"),
//	        workflow.WithName("daily-sync"),
//	        workflow.WithVersion("1.0.0"),
//	    )
//	    return err
//	})
//
// Example with custom slug:
//
//	wf, err := workflow.New(ctx,
//	    workflow.WithNamespace("data-processing"),
//	    workflow.WithName("Daily Data Sync"),
//	    workflow.WithSlug("daily-sync"),  // Custom slug
//	    workflow.WithVersion("1.0.0"),
//	)
func New(ctx Context, opts ...Option) (*Workflow, error) {
	w := &Workflow{
		Document: Document{
			DSL: "1.0.0", // Default DSL version
		},
		Tasks:                []*Task{},
		EnvironmentVariables: []environment.Variable{},
		ctx:                  ctx,
	}

	// Apply all options
	for _, opt := range opts {
		if err := opt(w); err != nil {
			return nil, err
		}
	}

	// Auto-generate slug from name if not provided
	if w.Slug == "" && w.Document.Name != "" {
		w.Slug = naming.GenerateSlug(w.Document.Name)
	}

	// If name not provided but slug is, use slug as name
	if w.Document.Name == "" && w.Slug != "" {
		w.Document.Name = w.Slug
	}

	// Auto-generate version if not provided
	if w.Document.Version == "" {
		w.Document.Version = "0.1.0" // Default version for development
	}

	// Validate the workflow
	if err := validate(w); err != nil {
		return nil, err
	}

	// Validate slug format
	if w.Slug != "" {
		if err := naming.ValidateSlug(w.Slug); err != nil {
			return nil, err
		}
	}

	// Register with context (if provided)
	if ctx != nil {
		ctx.RegisterWorkflow(w)
	}

	return w, nil
}

// WithNamespace sets the workflow namespace.
//
// The namespace is used for organization/categorization.
// This is a required field.
//
// Example:
//
//	workflow.WithNamespace("data-processing")
func WithNamespace(namespace string) Option {
	return func(w *Workflow) error {
		w.Document.Namespace = namespace
		return nil
	}
}

// WithName sets the workflow name.
//
// The name must be unique within the namespace.
// This is a required field.
//
// Example:
//
//	workflow.WithName("daily-sync")
func WithName(name string) Option {
	return func(w *Workflow) error {
		w.Document.Name = name
		return nil
	}
}

// WithVersion sets the workflow version.
//
// The version must be valid semver (e.g., "1.0.0").
// This is a required field.
//
// Example:
//
//	workflow.WithVersion("1.0.0")
func WithVersion(version string) Option {
	return func(w *Workflow) error {
		w.Document.Version = version
		return nil
	}
}

// WithDescription sets the workflow description.
//
// Description is displayed in UI and marketplace.
// This is an optional field.
//
// Example:
//
//	workflow.WithDescription("Process data from external API")
func WithDescription(description string) Option {
	return func(w *Workflow) error {
		w.Description = description
		w.Document.Description = description
		return nil
	}
}

// WithOrg sets the organization that owns this workflow.
//
// This is an optional field.
//
// Accepts either a string or a StringRef from context.
//
// Examples:
//
//	workflow.WithOrg("my-org")                                    // Legacy string
//	workflow.WithOrg(ctx.SetString("org", "my-org"))              // Typed context
func WithOrg(org interface{}) Option {
	return func(w *Workflow) error {
		// Convert to string using the helper
		switch v := org.(type) {
		case string:
			w.Org = v
		case Ref:
			// For synthesis, we need the actual value
			// For StringRef, we can extract the value
			if stringVal, ok := v.(interface{ Value() string }); ok {
				w.Org = stringVal.Value()
			} else {
				// Fallback: use expression (though this is uncommon for org)
				w.Org = v.Expression()
			}
		default:
			w.Org = fmt.Sprintf("%v", org)
		}
		return nil
	}
}

// WithTask adds a task to the workflow.
//
// Tasks are executed in the order they are added.
//
// Example:
//
//	workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1")))
func WithTask(task *Task) Option {
	return func(w *Workflow) error {
		w.Tasks = append(w.Tasks, task)
		return nil
	}
}

// WithTasks adds multiple tasks to the workflow.
//
// Example:
//
//	workflow.WithTasks(
//	    workflow.Set("init", workflow.SetVar("x", "1")),
//	    workflow.HttpGet("fetch", "https://api.example.com"),
//	)
func WithTasks(tasks ...*Task) Option {
	return func(w *Workflow) error {
		w.Tasks = append(w.Tasks, tasks...)
		return nil
	}
}

// WithEnvironmentVariable adds an environment variable to the workflow.
//
// Environment variables define what external configuration the workflow needs to run.
//
// Example:
//
//	apiToken, _ := environment.New(
//	    environment.WithName("API_TOKEN"),
//	    environment.WithSecret(true),
//	)
//	workflow.WithEnvironmentVariable(apiToken)
func WithEnvironmentVariable(variable environment.Variable) Option {
	return func(w *Workflow) error {
		w.EnvironmentVariables = append(w.EnvironmentVariables, variable)
		return nil
	}
}

// WithEnvironmentVariables adds multiple environment variables to the workflow.
//
// Example:
//
//	apiToken, _ := environment.New(environment.WithName("API_TOKEN"), environment.WithSecret(true))
//	apiURL, _ := environment.New(environment.WithName("API_URL"))
//	workflow.WithEnvironmentVariables(apiToken, apiURL)
func WithEnvironmentVariables(variables ...environment.Variable) Option {
	return func(w *Workflow) error {
		w.EnvironmentVariables = append(w.EnvironmentVariables, variables...)
		return nil
	}
}

// WithSlug sets a custom slug for the workflow.
//
// By default, slugs are auto-generated from the name by converting to lowercase
// and replacing spaces with hyphens. Use this option to override the auto-generation.
//
// The slug must contain only lowercase letters, numbers, and hyphens.
// It cannot start or end with a hyphen.
//
// Example:
//
//	workflow.WithSlug("my-custom-workflow")
func WithSlug(slug string) Option {
	return func(w *Workflow) error {
		w.Slug = slug
		return nil
	}
}

// AddTask adds a task to the workflow after creation.
//
// This is a builder method that allows adding tasks after the workflow is created.
//
// Example:
//
//	wf, _ := workflow.New(workflow.WithNamespace("ns"), workflow.WithName("wf"), workflow.WithVersion("1.0.0"))
//	wf.AddTask(workflow.Set("init", workflow.SetVar("x", "1")))
func (w *Workflow) AddTask(task *Task) *Workflow {
	w.Tasks = append(w.Tasks, task)
	return w
}

// AddTasks adds multiple tasks to the workflow after creation.
//
// Example:
//
//	wf, _ := workflow.New(...)
//	wf.AddTasks(
//	    workflow.Set("init", workflow.SetVar("x", "1")),
//	    workflow.HttpGet("fetch", "https://api.example.com"),
//	)
func (w *Workflow) AddTasks(tasks ...*Task) *Workflow {
	w.Tasks = append(w.Tasks, tasks...)
	return w
}

// AddEnvironmentVariable adds an environment variable to the workflow after creation.
//
// Example:
//
//	wf, _ := workflow.New(...)
//	apiToken, _ := environment.New(environment.WithName("API_TOKEN"))
//	wf.AddEnvironmentVariable(apiToken)
func (w *Workflow) AddEnvironmentVariable(variable environment.Variable) *Workflow {
	w.EnvironmentVariables = append(w.EnvironmentVariables, variable)
	return w
}

// AddEnvironmentVariables adds multiple environment variables to the workflow after creation.
//
// Example:
//
//	wf, _ := workflow.New(...)
//	wf.AddEnvironmentVariables(apiToken, apiURL)
func (w *Workflow) AddEnvironmentVariables(variables ...environment.Variable) *Workflow {
	w.EnvironmentVariables = append(w.EnvironmentVariables, variables...)
	return w
}

// ============================================================================
// Convenience Methods (Pulumi-Style Task Builders)
// ============================================================================

// HttpGet creates an HTTP GET task and adds it to the workflow.
// This is a clean, Pulumi-style builder for the most common HTTP pattern.
//
// The task is automatically added to the workflow and supports implicit dependencies
// when using TaskFieldRef values.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//
//	// Clean, one-line GET request
//	fetchTask := wf.HttpGet("fetch", "https://api.example.com/posts/1",
//	    Header("Content-Type", "application/json"),
//	    Timeout(30),
//	)
//
//	// Use task outputs with clear origin
//	processTask := wf.Set("process",
//	    SetVar("title", fetchTask.Field("title")),  // Implicit dependency!
//	)
func (w *Workflow) HttpGet(name string, uri string, headers map[string]string) *Task {
	task := HttpGet(name, uri, headers)
	w.AddTask(task)
	return task
}

// HttpPost creates an HTTP POST task and adds it to the workflow.
// This is a clean, Pulumi-style builder for POST requests.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//	createTask := wf.HttpPost("createUser", "https://api.example.com/users",
//	    Body(map[string]any{
//	        "name": "John Doe",
//	        "email": "john@example.com",
//	    }),
//	    Header("Authorization", "Bearer token"),
//	)
func (w *Workflow) HttpPost(name string, uri string, headers map[string]string, body map[string]interface{}) *Task {
	task := HttpPost(name, uri, headers, body)
	w.AddTask(task)
	return task
}

// HttpPut creates an HTTP PUT task and adds it to the workflow.
// This is a clean, Pulumi-style builder for PUT requests.
//
// Example:
//
//	updateTask := wf.HttpPut("updateUser", "https://api.example.com/users/123",
//	    Body(map[string]any{"status": "active"}),
//	)
func (w *Workflow) HttpPut(name string, uri string, headers map[string]string, body map[string]interface{}) *Task {
	task := HttpPut(name, uri, headers, body)
	w.AddTask(task)
	return task
}

// HttpPatch creates an HTTP PATCH task and adds it to the workflow.
// This is a clean, Pulumi-style builder for PATCH requests.
//
// Example:
//
//	patchTask := wf.HttpPatch("patchUser", "https://api.example.com/users/123",
//	    Body(map[string]any{"email": "newemail@example.com"}),
//	)
func (w *Workflow) HttpPatch(name string, uri string, headers map[string]string, body map[string]interface{}) *Task {
	task := HttpPatch(name, uri, headers, body)
	w.AddTask(task)
	return task
}

// HttpDelete creates an HTTP DELETE task and adds it to the workflow.
// This is a clean, Pulumi-style builder for DELETE requests.
//
// Example:
//
//	deleteTask := wf.HttpDelete("deleteUser", "https://api.example.com/users/123",
//	    Header("Authorization", "Bearer token"),
//	)
func (w *Workflow) HttpDelete(name string, uri string, headers map[string]string) *Task {
	task := HttpDelete(name, uri, headers)
	w.AddTask(task)
	return task
}

// Set creates a SET task for setting variables and adds it to the workflow.
// This is a clean, Pulumi-style builder.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//	fetchTask := wf.HttpGet("fetch", endpoint)
//
//	// Clean variable setting with implicit dependencies
//	processTask := wf.Set("process",
//	    SetVar("title", fetchTask.Field("title")),  // Implicit dependency!
//	    SetVar("body", fetchTask.Field("body")),
//	    SetVar("status", "success"),
//	)
func (w *Workflow) Set(name string, args *SetArgs) *Task {
	task := Set(name, args)
	w.AddTask(task)
	return task
}

// CallAgent creates an agent call task and adds it to the workflow.
//
// This is a convenience method combining task creation and workflow registration.
// It enables Pulumi-style fluent API for calling agents within workflows.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//	reviewTask := wf.CallAgent("review",
//	    AgentOption(AgentBySlug("code-reviewer")),
//	    Message("Review PR: ${.input.prUrl}"),
//	    WithAgentEnv(map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    }),
//	)
//	reviewTask.ExportAll()
func (w *Workflow) CallAgent(name string, args *AgentCallArgs) *Task {
	task := AgentCall(name, args)
	w.AddTask(task)
	return task
}

// Switch creates a SWITCH task for conditional logic and adds it to the workflow.
// This is a clean, Pulumi-style builder for conditional branching.
//
// The switch task evaluates conditions and routes execution to different tasks
// based on the results.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//	checkTask := wf.HttpGet("check", endpoint)
//
//	// Route based on status code
//	switchTask := wf.Switch("route",
//	    SwitchOn(checkTask.Field("statusCode")),
//	    Case(Equals(200), "success"),
//	    Case(Equals(404), "notFound"),
//	    DefaultCase("error"),
//	)
func (w *Workflow) Switch(name string, args *SwitchArgs) *Task {
	task := Switch(name, args)
	w.AddTask(task)
	return task
}

// ForEach creates a FOR task for iteration and adds it to the workflow.
// This is a clean, Pulumi-style builder for looping over collections.
//
// The for-each task iterates over a collection and executes a set of tasks
// for each item.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//	fetchTask := wf.HttpGet("fetch", apiBase.Concat("/items"))
//
//	// Process each item
//	loopTask := wf.ForEach("processItems",
//	    IterateOver(fetchTask.Field("items")),
//	    DoTasks([]map[string]interface{}{
//	        {"httpCall": map[string]interface{}{"uri": "${.api}/process"}},
//	    }),
//	)
func (w *Workflow) ForEach(name string, args *ForArgs) *Task {
	task := For(name, args)
	w.AddTask(task)
	return task
}

// Try creates a TRY task for error handling and adds it to the workflow.
// This is a clean, Pulumi-style builder for try/catch error handling.
//
// The try task executes a set of tasks and handles any errors that occur.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//
//	// Try to make API call with error handling
//	tryTask := wf.Try("attemptAPICall",
//	    TryTasks([]map[string]interface{}{
//	        {"httpCall": map[string]interface{}{"uri": endpoint}},
//	    }),
//	    Catch(map[string]interface{}{
//	        "errors": []string{"NetworkError"},
//	        "as": "error",
//	        "tasks": []interface{}{...},
//	    }),
//	)
func (w *Workflow) Try(name string, args *TryArgs) *Task {
	task := Try(name, args)
	w.AddTask(task)
	return task
}

// Fork creates a FORK task for parallel execution and adds it to the workflow.
// This is a clean, Pulumi-style builder for parallel branches.
//
// The fork task executes multiple branches in parallel.
//
// Example:
//
//	wf := workflow.New(ctx, ...)
//
//	// Execute multiple API calls in parallel
//	forkTask := wf.Fork("fetchAll",
//	    Branch(map[string]interface{}{
//	        "name": "fetchUsers",
//	        "tasks": []interface{}{...},
//	    }),
//	    Branch(map[string]interface{}{
//	        "name": "fetchProducts",
//	        "tasks": []interface{}{...},
//	    }),
//	)
func (w *Workflow) Fork(name string, args *ForkArgs) *Task {
	task := Fork(name, args)
	w.AddTask(task)
	return task
}

// String returns a string representation of the Workflow.
func (w *Workflow) String() string {
	return "Workflow(namespace=" + w.Document.Namespace + ", name=" + w.Document.Name + ", version=" + w.Document.Version + ")"
}
