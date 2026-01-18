// Package workflow provides types and builders for creating Stigmer workflows
// with Pulumi-aligned patterns.
//
// Workflows are orchestration definitions that execute a series of tasks with
// automatic dependency tracking, typed context variables, and clean builder APIs.
//
// # Creating Workflows
//
// Use NewWithContext() within a stigmer.Run() block:
//
//	err := stigmer.Run(func(ctx *stigmer.Context) error {
//	    // Context for shared configuration
//	    orgName := ctx.SetString("org", "my-org")
//	    
//	    // Create workflow
//	    wf, err := workflow.New(ctx,
//	        workflow.WithNamespace("data-processing"),
//	        workflow.WithName("daily-sync"),
//	        workflow.WithVersion("1.0.0"),
//	        workflow.WithOrg(orgName),
//	    )
//	    if err != nil {
//	        return err
//	    }
//	    
//	    // Add tasks using workflow methods...
//	    return nil
//	})
//
// # Adding Tasks - Pulumi-Aligned Patterns
//
// ## HTTP Tasks (Clean Builders)
//
// Use convenience methods for common HTTP operations:
//
//	// HTTP GET - clean one-liner
//	fetchTask := wf.HttpGet("fetchData", endpoint,
//	    workflow.Header("Content-Type", "application/json"),
//	    workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
//	    workflow.Timeout(30),
//	)
//	
//	// HTTP POST
//	createTask := wf.HttpPost("createItem", apiEndpoint,
//	    workflow.Header("Content-Type", "application/json"),
//	    workflow.Body(`{"name": "item1"}`),
//	)
//	
//	// HTTP PUT
//	updateTask := wf.HttpPut("updateItem", updateEndpoint,
//	    workflow.Body(`{"status": "active"}`),
//	)
//	
//	// HTTP DELETE
//	deleteTask := wf.HttpDelete("deleteItem", deleteEndpoint)
//
// ## Setting Variables
//
// Use wf.SetVars() for clean variable assignment:
//
//	// Set multiple variables
//	varsTask := wf.SetVars("initialize",
//	    "apiURL", "https://api.example.com",
//	    "retryCount", 3,
//	    "debug", true,
//	)
//
// ## Direct Task Output References
//
// Reference task outputs directly - dependencies are automatic:
//
//	// Task 1: Fetch user data
//	userTask := wf.HttpGet("getUser", userEndpoint)
//	
//	// Task 2: Use user output (dependency is automatic!)
//	postsTask := wf.HttpGet("getPosts",
//	    userTask.Field("id").Concat("/posts"),  // Direct reference!
//	)
//	
//	// Task 3: Process results (depends on both tasks)
//	summaryTask := wf.SetVars("createSummary",
//	    "userName", userTask.Field("name"),     // From userTask
//	    "postCount", postsTask.Field("total"),  // From postsTask
//	)
//	
//	// Dependency chain: userTask → postsTask → summaryTask
//	// All automatic through field references!
//
// # Task Field References - The Core Pattern
//
// Task field references make data flow explicit and enable automatic dependency tracking:
//
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	
//	// ✅ Good: Direct reference with clear origin
//	processTask := wf.SetVars("process",
//	    "title", fetchTask.Field("title"),  // From fetchTask!
//	    "body", fetchTask.Field("body"),    // From fetchTask!
//	)
//	
//	// ❌ Bad: Magic string reference (OLD API)
//	// workflow.FieldRef("title")  // Where does "title" come from???
//
// The fetchTask.Field("title") pattern:
// 1. Creates a TaskFieldRef that knows its source
// 2. Automatically registers dependency
// 3. Generates correct expression in manifest
// 4. Makes data flow obvious to readers
//
// # Context for Configuration Only
//
// Following Pulumi's pulumi.Config pattern, context is for configuration ONLY:
//
//	// ✅ Good: Configuration
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	orgName := ctx.SetString("org", "my-org")
//	timeout := ctx.SetInt("timeout", 30)
//	
//	// Use in workflow metadata
//	wf, _ := workflow.New(ctx,
//	    workflow.WithOrg(orgName),
//	)
//	
//	// Use to build task inputs
//	endpoint := apiBase.Concat("/users/123")
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	
//	// ❌ Bad: Don't use context for workflow internal data flow
//	// Internal task-to-task data flow uses TaskFieldRef, not context!
//
// # Implicit Dependencies
//
// Dependencies are inferred from field references (like Pulumi's bucket.ID() pattern):
//
//	// Create tasks that reference each other
//	step1 := wf.HttpGet("step1", endpoint1)
//	step2 := wf.HttpGet("step2", 
//	    step1.Field("nextUrl"),  // References step1
//	)
//	step3 := wf.SetVars("step3",
//	    "data1", step1.Field("result"),  // References step1
//	    "data2", step2.Field("result"),  // References step2
//	)
//	
//	// Dependency graph built automatically:
//	// step1 → step2
//	// step1 → step3
//	// step2 → step3
//	
//	// No manual ThenRef() or DependsOn() needed!
//
// # Task Types
//
// The workflow package supports all Zigflow DSL task types:
//
//   - SET: Assign variables (use wf.SetVars())
//   - HTTP_CALL: HTTP requests (use wf.HttpGet/Post/Put/Delete())
//   - GRPC_CALL: gRPC calls
//   - SWITCH: Conditional branching
//   - FOR: Iterate over collections
//   - FORK: Parallel task execution
//   - TRY: Error handling with catch blocks
//   - LISTEN: Wait for external events
//   - WAIT: Pause execution for a duration
//   - CALL_ACTIVITY: Execute Temporal activities
//   - RAISE: Throw errors
//   - RUN: Execute sub-workflows
//
// # Environment Variables
//
// Workflows can declare required environment variables:
//
//	import "github.com/stigmer/stigmer/sdk/go/environment"
//	
//	apiToken, _ := environment.New(
//	    environment.WithName("API_TOKEN"),
//	    environment.WithSecret(true),
//	    environment.WithDescription("API authentication token"),
//	)
//	
//	wf, _ := workflow.New(ctx,
//	    workflow.WithName("my-workflow"),
//	    workflow.WithEnvironmentVariable(apiToken),
//	)
//
// # Type Safety
//
// Typed references provide compile-time safety:
//
//	// Context variables are typed
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	timeout := ctx.SetInt("timeout", 30)
//	
//	// ✅ Type-safe operations
//	endpoint := apiBase.Concat("/users")  // StringRef.Concat()
//	
//	// ✅ Task references are checked
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	processTask := wf.SetVars("process",
//	    "data", fetchTask.Field("result"),  // fetchTask is a *Task
//	)
//	
//	// ❌ Compile error - not a task
//	wrongVar := "some-string"
//	wf.SetVars("process",
//	    "data", wrongVar.Field("result"),  // Type error!
//	)
//
// # Complete Example
//
// Pulumi-aligned workflow with all features:
//
//	package main
//	
//	import (
//	    "log"
//	    "github.com/stigmer/stigmer/sdk/go/stigmer"
//	    "github.com/stigmer/stigmer/sdk/go/workflow"
//	    "github.com/stigmer/stigmer/sdk/go/environment"
//	)
//	
//	func main() {
//	    err := stigmer.Run(func(ctx *stigmer.Context) error {
//	        // Context: shared configuration
//	        apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	        orgName := ctx.SetString("org", "my-org")
//	        
//	        // Environment variable
//	        apiToken, _ := environment.New(
//	            environment.WithName("API_TOKEN"),
//	            environment.WithSecret(true),
//	        )
//	        
//	        // Create workflow
//	        wf, _ := workflow.New(ctx,
//	            workflow.WithNamespace("data-processing"),
//	            workflow.WithName("user-sync"),
//	            workflow.WithVersion("1.0.0"),
//	            workflow.WithOrg(orgName),
//	            workflow.WithEnvironmentVariable(apiToken),
//	        )
//	        
//	        // Task 1: Fetch user data
//	        userEndpoint := apiBase.Concat("/users/123")
//	        userTask := wf.HttpGet("getUser", userEndpoint,
//	            workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
//	        )
//	        
//	        // Task 2: Fetch user's posts (depends on userTask)
//	        postsTask := wf.HttpGet("getPosts",
//	            apiBase.Concat("/posts?userId=").Concat(userTask.Field("id")),
//	        )
//	        
//	        // Task 3: Create summary (depends on both tasks)
//	        summaryTask := wf.SetVars("createSummary",
//	            "userName", userTask.Field("name"),
//	            "userEmail", userTask.Field("email"),
//	            "postCount", postsTask.Field("total"),
//	            "firstPost", postsTask.Field("items[0].title"),
//	        )
//	        
//	        log.Printf("Created workflow with %d tasks", len(wf.Tasks))
//	        // Dependencies: userTask → postsTask → summaryTask (automatic!)
//	        return nil
//	    })
//	    
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	}
//
// # Migration from Old API
//
// If you're migrating from the old API:
//
//	// OLD ❌
//	task := workflow.HttpCallTask("fetch",
//	    workflow.WithHTTPGet(),
//	    workflow.WithURI(endpoint),
//	).ExportAll()
//	
//	processTask := workflow.SetTask("process",
//	    workflow.SetVar("title", workflow.FieldRef("title")),  // Magic string
//	)
//	task.ThenRef(processTask)  // Manual dependency
//	
//	// NEW ✅
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	
//	processTask := wf.SetVars("process",
//	    "title", fetchTask.Field("title"),  // Direct reference
//	)
//	// Dependency is automatic!
//
// See docs/guides/typed-context-migration.md for a complete migration guide.
//
// # Validation
//
// Workflows are validated when created and when tasks are added:
//
//   - Metadata: namespace, name, and version are required (version must be semver)
//   - Tasks: must have at least one task
//   - Task names: must be unique within workflow
//   - Task configs: validated based on task type
//   - Dependencies: validated to prevent cycles
//
// # Synthesis
//
// Workflows are automatically synthesized when stigmer.Run() completes:
//
// 1. Context variables resolved to expressions
// 2. Task field references resolved to $context.taskName.field expressions
// 3. Dependency graph built from references
// 4. Tasks topologically sorted
// 5. Proto manifest generated
// 6. Manifest written to workflow-manifest.pb
//
// # Documentation
//
// For comprehensive documentation:
//
//   - Architecture: docs/architecture/pulumi-aligned-patterns.md
//   - Migration Guide: docs/guides/typed-context-migration.md
//   - Examples: examples/07_basic_workflow.go
//   - Full Docs: docs/README.md
//
// # Version
//
// This is the NEW Pulumi-aligned API (2026-01-16+).
// For the OLD API, see examples/07_basic_workflow_legacy.go for comparison.
package workflow
