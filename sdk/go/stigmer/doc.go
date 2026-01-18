// Package stigmer provides the core orchestration layer for the Stigmer Go SDK.
//
// This package enables defining AI agents and workflows with a Pulumi-aligned API
// featuring typed context variables, implicit dependency tracking, and automatic
// manifest synthesis.
//
// # Quick Start - Agent
//
// Create an agent with typed context:
//
//	err := stigmer.Run(func(ctx *stigmer.Context) error {
//	    // Context for shared configuration
//	    orgName := ctx.SetString("org", "my-org")
//	    iconBase := ctx.SetString("iconBase", "https://cdn.example.com")
//	    
//	    // Create agent
//	    ag, err := agent.New(ctx,
//	        agent.WithName("code-reviewer"),
//	        agent.WithInstructions("Review code and suggest improvements"),
//	        agent.WithOrg(orgName),
//	        agent.WithIconURL(iconBase.Concat("/reviewer.png")),
//	    )
//	    if err != nil {
//	        return err
//	    }
//	    
//	    // Agent automatically synthesized on return
//	    return nil
//	})
//
// # Quick Start - Workflow
//
// Create a workflow with Pulumi-aligned patterns:
//
//	err := stigmer.Run(func(ctx *stigmer.Context) error {
//	    // Context ONLY for configuration (not workflow data flow)
//	    apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	    orgName := ctx.SetString("org", "my-org")
//	    
//	    // Create workflow
//	    wf, _ := workflow.New(ctx,
//	        workflow.WithName("data-fetch"),
//	        workflow.WithOrg(orgName),
//	    )
//	    
//	    // Task 1: HTTP GET (clean, one-liner!)
//	    endpoint := apiBase.Concat("/posts/1")
//	    fetchTask := wf.HttpGet("fetch", endpoint)
//	    
//	    // Task 2: Process with direct references (implicit dependencies!)
//	    processTask := wf.SetVars("process",
//	        "title", fetchTask.Field("title"),  // From fetchTask - clear!
//	        "body", fetchTask.Field("body"),
//	    )
//	    
//	    // Dependencies are automatic - no manual wiring!
//	    return nil
//	})
//
// # Core Concepts
//
// ## Context
//
// Context provides typed configuration variables shared between workflows and agents.
// Following Pulumi's pulumi.Config pattern, context is for configuration ONLY,
// not for internal workflow data flow.
//
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")  // Config
//	timeout := ctx.SetInt("timeout", 30)                            // Config
//	
//	// Use in workflow metadata or task inputs
//	wf.WithOrg(ctx.SetString("org", "my-org"))
//	endpoint := apiBase.Concat("/users")
//
// ## Typed References
//
// Context variables are typed references (StringRef, IntRef, BoolRef, ObjectRef)
// that provide compile-time safety and IDE autocomplete:
//
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	endpoint := apiBase.Concat("/posts")  // ✅ Type-safe string operations
//
// ## Task Output References
//
// Tasks produce outputs that other tasks can reference directly, making data flow
// explicit and enabling automatic dependency tracking:
//
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	processTask := wf.SetVars("process",
//	    "title", fetchTask.Field("title"),  // Direct reference - clear origin!
//	)
//	// Dependency is automatic: processTask depends on fetchTask
//
// ## Implicit Dependencies
//
// Like Pulumi's resource.Output() pattern, dependencies are inferred from field
// references - no manual ThenRef() or DependsOn() needed:
//
//	userTask := wf.HttpGet("getUser", userEndpoint)
//	postsTask := wf.HttpGet("getPosts", 
//	    userTask.Field("id").Concat("/posts"),  // References userTask
//	)
//	// Dependency chain: userTask → postsTask (automatic!)
//
// ## Automatic Synthesis
//
// stigmer.Run() automatically synthesizes manifests when the function returns:
//
//	err := stigmer.Run(func(ctx *stigmer.Context) error {
//	    // Create workflows and agents...
//	    return nil
//	    // Manifests synthesized automatically here!
//	})
//
// # Architecture
//
// The SDK follows Pulumi-aligned infrastructure-as-code patterns:
//
// 1. Context for Configuration (like pulumi.Config)
// 2. Direct Output References (like bucket.ID())
// 3. Implicit Dependencies (inferred from references)
// 4. Clean Builders (intuitive one-liners)
// 5. Type Safety (compile-time checks)
//
// This makes the SDK feel like writing Pulumi code, not wrangling proto messages.
//
// # Key Packages
//
//   - stigmer: Core orchestration and context management
//   - workflow: Workflow builder with Pulumi-aligned task APIs
//   - agent: Agent builder with typed context support
//   - skill: Skill reference configuration
//   - mcpserver: MCP server definitions (stdio, HTTP, Docker)
//   - subagent: Sub-agent configuration (inline and referenced)
//   - environment: Environment variable configuration
//
// # Design Patterns
//
// ## stigmer.Run() Pattern
//
// The stigmer.Run() function provides automatic context management and synthesis:
//
//	err := stigmer.Run(func(ctx *stigmer.Context) error {
//	    // All resources created here are automatically tracked and synthesized
//	    return nil
//	})
//
// ## Context Variable Pattern
//
// Use context for shared configuration, not workflow data flow:
//
//	// ✅ Good: Configuration
//	apiBase := ctx.SetString("apiBase", "https://api.example.com")
//	orgName := ctx.SetString("org", "my-org")
//	
//	// ❌ Bad: Don't use context for workflow internal state
//	// Internal state belongs in tasks, not context
//
// ## Direct Reference Pattern
//
// Reference task outputs directly to make data flow explicit:
//
//	// ✅ Good: Direct reference with clear origin
//	fetchTask := wf.HttpGet("fetch", endpoint)
//	processTask := wf.SetVars("process",
//	    "title", fetchTask.Field("title"),  // From fetchTask!
//	)
//	
//	// ❌ Bad: Magic string reference (OLD API)
//	// workflow.FieldRef("title")  // Where does "title" come from???
//
// ## Clean Builder Pattern
//
// Use convenience methods for common operations:
//
//	// ✅ Good: Clean, intuitive
//	task := wf.HttpGet("fetch", endpoint,
//	    workflow.Header("Content-Type", "application/json"),
//	    workflow.Timeout(30),
//	)
//	
//	// ❌ Bad: Verbose (OLD API)
//	// task := workflow.HttpCallTask("fetch",
//	//     workflow.WithHTTPGet(),
//	//     workflow.WithURI(endpoint),
//	//     ...
//	// )
//
// # Proto Conversion
//
// The SDK is proto-agnostic - users write pure Go code without thinking about protos.
// CLI tools handle conversion to protobuf messages for the Stigmer platform.
//
// During stigmer.Run(), the SDK:
// 1. Tracks all workflows and agents
// 2. Resolves typed references to expressions
// 3. Builds dependency graphs
// 4. Synthesizes proto manifests
// 5. Writes manifest files
//
// # Migration from Old API
//
// If you're migrating from the old string-based API:
//
// 1. Package: stigmeragent → stigmer
// 2. Field refs: workflow.FieldRef("field") → task.Field("field")
// 3. Dependencies: Manual ThenRef() → Implicit via references
// 4. HTTP tasks: WithHTTPGet() + WithURI() → wf.HttpGet(name, uri)
// 5. Context scope: Everything → Configuration only
//
// See docs/guides/typed-context-migration.md for a complete migration guide.
//
// # Examples
//
// For complete working examples, see:
//
//   - examples/07_basic_workflow.go - Complete workflow with Pulumi-aligned patterns
//   - examples/08_agent_with_typed_context.go - Agent with typed context
//   - examples/09_workflow_and_agent_shared_context.go - Shared context patterns
//
// # Documentation
//
// For comprehensive documentation:
//
//   - Architecture: docs/architecture/pulumi-aligned-patterns.md
//   - Migration Guide: docs/guides/typed-context-migration.md
//   - Full Docs: docs/README.md
//
// # Version
//
// This is the NEW Pulumi-aligned API (2026-01-16+).
// For the OLD API, see legacy examples (07_basic_workflow_legacy.go).
package stigmer
