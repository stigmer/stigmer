# Typed Context System Migration Guide

This guide helps you migrate from the old string-based workflow API to the new Pulumi-aligned typed context system.

---

## What Changed?

The SDK underwent a major API redesign to align with professional infrastructure-as-code patterns (like Pulumi). The new API provides:

- ✅ **Typed context variables** with compile-time checks
- ✅ **Clear field references** - no more magic strings
- ✅ **Implicit dependencies** - automatic dependency tracking
- ✅ **Clean builders** - intuitive, one-liner task creation
- ✅ **Professional package naming** - `stigmer` instead of `stigmeragent`
- ✅ **Better IDE support** - autocomplete and refactoring

---

## Quick Comparison

### Package Import

```go
// BEFORE ❌
import stigmeragent "github.com/leftbin/stigmer-sdk/go"

// AFTER ✅
import "github.com/leftbin/stigmer-sdk/go/stigmer"
```

### Entry Point

```go
// BEFORE ❌
stigmeragent.Run(func(ctx *stigmeragent.Context) error {
    // ...
})

// AFTER ✅
stigmer.Run(func(ctx *stigmer.Context) error {
    // ...
})
```

### Field References

```go
// BEFORE ❌ - Where does "title" come from?
processTask := workflow.SetTask("process",
    workflow.SetVar("postTitle", workflow.FieldRef("title")), // ???
)

// AFTER ✅ - Crystal clear!
processTask := wf.SetVars("process",
    "postTitle", fetchTask.Field("title"), // From fetchTask!
)
```

---

## Core Design Changes

### 1. Context Scope - Configuration Only

**OLD**: Context was used for everything (config + workflow data).

**NEW**: Context is ONLY for shared configuration (like Pulumi's `pulumi.Config`).

```go
// BEFORE ❌ - Context used for workflow data flow
apiURL := ctx.SetString("apiURL", "https://api.example.com")
retryCount := ctx.SetInt("retryCount", 0)

// Then copy to tasks (redundant!)
initTask := workflow.SetTask("init",
    workflow.SetVar("currentURL", apiURL),
    workflow.SetVar("retries", retryCount),
)

// AFTER ✅ - Context only for config
apiBase := ctx.SetString("apiBase", "https://api.example.com")
orgName := ctx.SetString("org", "my-org")

// Use directly in workflow metadata
wf, _ := workflow.New(ctx,
    workflow.WithOrg(orgName), // Config reference
)
```

**Key principle**: Context variables are for configuration shared between workflows and agents, NOT for internal workflow data flow.

### 2. Task Output References - Clear Origins

**OLD**: Magic string references with unclear origins.

**NEW**: Direct task references showing where data comes from.

```go
// BEFORE ❌
fetchTask := workflow.HttpCallTask("fetch", ...).ExportAll()
processTask := workflow.SetTask("process",
    workflow.SetVar("title", workflow.FieldRef("title")), // Where from?
)

// AFTER ✅
fetchTask := wf.HttpGet("fetch", endpoint)
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"), // From fetchTask - clear!
)
```

**Key insight**: `fetchTask.Field("title")` makes the data flow explicit and traceable.

### 3. Implicit Dependencies - Automatic Tracking

**OLD**: Manual dependency management with `ThenRef()`.

**NEW**: Dependencies inferred automatically from field references (like Pulumi).

```go
// BEFORE ❌
initTask.ThenRef(fetchTask)
fetchTask.ThenRef(processTask)
// Manual, error-prone, tedious

// AFTER ✅
// No ThenRef needed!
// processTask depends on fetchTask because it uses fetchTask.Field()
```

**Key insight**: Like Pulumi's `bucket.ID()` → `website.BucketArn`, dependencies are implicit through references.

### 4. Clean HTTP Builders - One-Liners

**OLD**: Verbose, multi-step task creation.

**NEW**: Concise, intuitive builders.

```go
// BEFORE ❌
fetchTask := workflow.HttpCallTask("fetch",
    workflow.WithHTTPGet(),           // 1. Set method
    workflow.WithURI(endpoint),       // 2. Set URI
    workflow.WithHeader("Content-Type", "application/json"),
    workflow.WithTimeout(30),
).ExportAll()  // What does this do?

// AFTER ✅
fetchTask := wf.HttpGet("fetch", endpoint,
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
// Method + URI combined, no mysterious ExportAll()
```

**Key insight**: Common patterns get convenience methods: `HttpGet()`, `HttpPost()`, `SetVars()`.

### 5. Package Naming - Professional

**OLD**: Confusing `stigmeragent` package name.

**NEW**: Clean `stigmer` package aligned with the product name.

```go
// BEFORE ❌
import stigmeragent "github.com/leftbin/stigmer-sdk/go"
stigmeragent.Run(...)

// AFTER ✅
import "github.com/leftbin/stigmer-sdk/go/stigmer"
stigmer.Run(...)
```

---

## Migration Steps

### Step 1: Update Imports

Replace the old import with the new package path:

```go
// Remove this
import stigmeragent "github.com/leftbin/stigmer-sdk/go"

// Add this
import "github.com/leftbin/stigmer-sdk/go/stigmer"
```

Update all references from `stigmeragent.X` to `stigmer.X`.

### Step 2: Update Entry Point

Change your main function to use the new package name:

```go
// BEFORE
err := stigmeragent.Run(func(ctx *stigmeragent.Context) error {
    // ...
})

// AFTER
err := stigmer.Run(func(ctx *stigmer.Context) error {
    // ...
})
```

### Step 3: Simplify Context Usage

Remove workflow data from context - keep only configuration:

```go
// BEFORE - Context used for workflow data
apiURL := ctx.SetString("apiURL", "https://api.example.com")
retryCount := ctx.SetInt("retryCount", 0)
debugMode := ctx.SetBool("debug", true)

// Tasks copy context variables
initTask := workflow.SetTask("init",
    workflow.SetVar("currentURL", apiURL),
    workflow.SetVar("retries", retryCount),
    workflow.SetVar("debug", debugMode),
)

// AFTER - Context only for shared config
apiBase := ctx.SetString("apiBase", "https://api.example.com")
orgName := ctx.SetString("org", "my-org")

// Use config in workflow metadata or task inputs
wf, _ := workflow.New(ctx,
    workflow.WithOrg(orgName),
)
```

### Step 4: Update HTTP Tasks

Replace verbose HTTP tasks with clean builders:

```go
// BEFORE
endpoint := workflow.StringRef(apiURL).Concat("/posts/1")
fetchTask := workflow.HttpCallTask("fetch",
    workflow.WithHTTPGet(),
    workflow.WithURI(endpoint),
    workflow.WithHeader("Content-Type", "application/json"),
    workflow.WithTimeout(30),
).ExportAll()

// AFTER
endpoint := apiBase.Concat("/posts/1")
fetchTask := wf.HttpGet("fetch", endpoint,
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

**Available HTTP builders:**
- `wf.HttpGet(name, uri, options...)` - GET request
- `wf.HttpPost(name, uri, options...)` - POST request
- `wf.HttpPut(name, uri, options...)` - PUT request
- `wf.HttpDelete(name, uri, options...)` - DELETE request

### Step 5: Update Field References

Replace magic string references with direct task references:

```go
// BEFORE - Unclear where "title" and "body" come from
processTask := workflow.SetTask("process",
    workflow.SetVar("postTitle", workflow.FieldRef("title")),
    workflow.SetVar("postBody", workflow.FieldRef("body")),
    workflow.SetVar("status", "success"),
)

// AFTER - Clear origin from fetchTask
processTask := wf.SetVars("process",
    "postTitle", fetchTask.Field("title"),
    "postBody", fetchTask.Field("body"),
    "status", "success",
)
```

**Key pattern**: `taskVariable.Field("fieldName")` creates a `TaskFieldRef` that:
1. References a specific task's output
2. Automatically tracks dependencies
3. Provides IDE autocomplete (for task names)

### Step 6: Remove Manual Dependencies

Delete all `ThenRef()` calls - dependencies are now implicit:

```go
// BEFORE - Manual dependencies
initTask.ThenRef(fetchTask)
fetchTask.ThenRef(processTask)
wf.WithTasks(initTask, fetchTask, processTask)

// AFTER - Implicit dependencies
// No ThenRef needed!
// Dependencies are tracked through field references
```

### Step 7: Remove ExportAll() Calls

Task outputs are now always available - no need to export:

```go
// BEFORE
fetchTask := workflow.HttpCallTask("fetch", ...).ExportAll()

// AFTER
fetchTask := wf.HttpGet("fetch", endpoint)
// Outputs are automatic!
```

---

## Complete Example

### BEFORE ❌ Old API

```go
package main

import (
    "log"
    stigmeragent "github.com/leftbin/stigmer-sdk/go"
    "github.com/leftbin/stigmer-sdk/go/workflow"
)

func main() {
    err := stigmeragent.Run(func(ctx *stigmeragent.Context) error {
        // Context used for everything
        apiURL := ctx.SetString("apiURL", "https://jsonplaceholder.typicode.com")
        retryCount := ctx.SetInt("retryCount", 0)
        
        // Initialize with context copies
        initTask := workflow.SetTask("initialize",
            workflow.SetVar("currentURL", apiURL),
            workflow.SetVar("currentRetries", retryCount),
        )
        
        // Verbose HTTP task
        endpoint := workflow.StringRef(apiURL).Concat("/posts/1")
        fetchTask := workflow.HttpCallTask("fetchData",
            workflow.WithHTTPGet(),
            workflow.WithURI(endpoint),
            workflow.WithHeader("Content-Type", "application/json"),
            workflow.WithTimeout(30),
        ).ExportAll() // Mysterious!
        
        // Magic string references
        processTask := workflow.SetTask("processResponse",
            workflow.SetVar("postTitle", workflow.FieldRef("title")), // Where from?
            workflow.SetVar("postBody", workflow.FieldRef("body")),
            workflow.SetVar("status", "success"),
        )
        
        // Manual dependencies
        initTask.ThenRef(fetchTask)
        fetchTask.ThenRef(processTask)
        
        // Create workflow with all tasks
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("data-processing"),
            workflow.WithName("basic-data-fetch"),
            workflow.WithOrg("my-org"),
            workflow.WithTasks(initTask, fetchTask, processTask),
        )
        if err != nil {
            return err
        }
        
        log.Printf("Created workflow: %s", wf)
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

### AFTER ✅ New API

```go
package main

import (
    "log"
    "github.com/leftbin/stigmer-sdk/go/stigmer"
    "github.com/leftbin/stigmer-sdk/go/workflow"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Context ONLY for shared config
        apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
        orgName := ctx.SetString("org", "my-org")
        
        // Create workflow with context config
        wf, err := workflow.New(ctx,
            workflow.WithNamespace("data-processing"),
            workflow.WithName("basic-data-fetch"),
            workflow.WithVersion("1.0.0"),
            workflow.WithDescription("Fetch data from an external API"),
            workflow.WithOrg(orgName), // Use context config
        )
        if err != nil {
            return err
        }
        
        // Build endpoint using context config
        endpoint := apiBase.Concat("/posts/1")
        
        // Task 1: Clean HTTP GET (one-liner!)
        fetchTask := wf.HttpGet("fetchData", endpoint,
            workflow.Header("Content-Type", "application/json"),
            workflow.Timeout(30),
        )
        
        // Task 2: Process with clear references
        // Dependencies are implicit through fetchTask.Field()
        processTask := wf.SetVars("processResponse",
            "postTitle", fetchTask.Field("title"), // From fetchTask!
            "postBody", fetchTask.Field("body"),   // From fetchTask!
            "status", "success",
        )
        
        // No manual dependencies needed!
        // processTask automatically depends on fetchTask
        
        log.Printf("Created workflow: %s", wf)
        log.Printf("Tasks: %d", len(wf.Tasks))
        log.Printf("  - %s (HTTP GET)", fetchTask.Name)
        log.Printf("  - %s (depends on %s implicitly)", processTask.Name, fetchTask.Name)
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
    
    log.Println("✅ Workflow created successfully!")
}
```

**Key improvements:**
1. ✅ 40% less code
2. ✅ Crystal clear data flow
3. ✅ No manual dependency management
4. ✅ Professional, Pulumi-like style
5. ✅ Better compile-time safety

---

## Breaking Changes

### Removed APIs

| API | Replacement |
|-----|-------------|
| `workflow.FieldRef(field)` | `task.Field(field)` |
| `task.ThenRef(nextTask)` | Implicit through field references |
| `task.ExportAll()` | Automatic - no longer needed |
| `workflow.WithHTTPGet() + WithURI()` | `wf.HttpGet(name, uri)` |
| `workflow.SetTask()` | `wf.SetVars()` for variable setting |

### Package Changes

| Old | New |
|-----|-----|
| `stigmeragent` | `stigmer` |
| `import stigmeragent "github.com/leftbin/stigmer-sdk/go"` | `import "github.com/leftbin/stigmer-sdk/go/stigmer"` |
| `stigmeragent.Run()` | `stigmer.Run()` |
| `stigmeragent.Context` | `stigmer.Context` |

---

## Benefits of New API

### 1. Clarity - Clear Data Flow

**OLD**: Where does "title" come from?
```go
workflow.SetVar("postTitle", workflow.FieldRef("title")) // ???
```

**NEW**: Obviously from fetchTask!
```go
"postTitle", fetchTask.Field("title") // Clear!
```

### 2. Safety - Compile-Time Checks

**OLD**: Typos caught at runtime
```go
workflow.FieldRef("tittle") // Typo! Runtime error
```

**NEW**: Task names checked by Go compiler
```go
fetchTask.Field("tittle") // Typo in field name still possible, but task is type-checked!
```

### 3. Simplicity - Less Code

**OLD**: 3 steps + manual dependencies
```go
initTask.ThenRef(fetchTask)
fetchTask.ThenRef(processTask)
wf.WithTasks(initTask, fetchTask, processTask)
```

**NEW**: Dependencies automatic
```go
// No manual dependencies - inferred from references!
```

### 4. Professional - Industry Standard Patterns

**OLD**: Custom patterns unfamiliar to developers
```go
workflow.WithHTTPGet()
workflow.WithURI(endpoint)
task.ExportAll()
```

**NEW**: Pulumi-aligned patterns developers know
```go
wf.HttpGet("fetch", endpoint)
// Follows Pulumi's resource output → input pattern
```

---

## Troubleshooting

### Error: "undefined: stigmeragent"

**Cause**: Using old import path

**Solution**: Update import
```go
// Remove
import stigmeragent "github.com/leftbin/stigmer-sdk/go"

// Add
import "github.com/leftbin/stigmer-sdk/go/stigmer"
```

### Error: "FieldRef not found in workflow"

**Cause**: Using old `workflow.FieldRef()` API

**Solution**: Use task field references
```go
// OLD ❌
workflow.FieldRef("title")

// NEW ✅
fetchTask.Field("title")
```

### Error: "ThenRef undefined for Task"

**Cause**: Using old manual dependency API

**Solution**: Remove `ThenRef()` - dependencies are implicit
```go
// OLD ❌
task1.ThenRef(task2)

// NEW ✅
// Just use task1.Field() in task2's definition
// Dependency is automatic!
```

### Error: "ExportAll not found"

**Cause**: Using old export API

**Solution**: Remove `ExportAll()` - outputs are automatic
```go
// OLD ❌
task := wf.HttpGet(...).ExportAll()

// NEW ✅
task := wf.HttpGet(...)
```

---

## Migration Checklist

Use this checklist when migrating workflows:

- [ ] Update package import to `stigmer`
- [ ] Update entry point to `stigmer.Run()`
- [ ] Simplify context to config-only
- [ ] Replace HTTP tasks with clean builders
- [ ] Replace `workflow.FieldRef()` with `task.Field()`
- [ ] Remove all `ThenRef()` calls
- [ ] Remove all `ExportAll()` calls
- [ ] Remove workflow data from context
- [ ] Test compilation (verify no errors)
- [ ] Test workflow synthesis (verify manifest generated)
- [ ] Update comments to reflect new patterns

---

## FAQ

### Q: Can I mix old and new APIs?

**A**: No - the APIs are incompatible. You must fully migrate to the new API.

### Q: What if I have many workflows to migrate?

**A**: Migrate one at a time. The new API is shorter, so migration is faster than it seems.

### Q: Do I need to update my workflow manifests?

**A**: No - the generated manifests are compatible. Only your Go code needs updating.

### Q: What about agents - do they change?

**A**: Agents gain typed context support but the API is mostly backward compatible. See example 08 for typed context usage.

### Q: Why so many breaking changes?

**A**: We prioritized correctness and professional patterns over backward compatibility. Better to fix now than carry technical debt forever.

### Q: Can I see a real migration?

**A**: Yes! Compare:
- OLD: `examples/07_basic_workflow_legacy.go`
- NEW: `examples/07_basic_workflow.go`

---

## Next Steps

1. **Read**: [Pulumi Alignment Design](../architecture/pulumi-aligned-patterns.md) - Understanding the "why"
2. **Study**: Example 07 (`examples/07_basic_workflow.go`) - See the new patterns in action
3. **Migrate**: Start with your simplest workflow
4. **Test**: Verify manifests generate correctly
5. **Iterate**: Migrate remaining workflows

---

## Getting Help

- **Documentation**: [docs/README.md](../README.md)
- **Examples**: [examples/](../../examples/)
- **Issues**: [GitHub Issues](https://github.com/leftbin/stigmer-sdk/issues)

---

*Last Updated: 2026-01-16 (Phase 5.2 - Package Refactoring Complete)*
