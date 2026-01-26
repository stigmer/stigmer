---
name: Phase 4 Pulumi Patterns
overview: Adopt Pulumi SDK patterns by adding context.Context support to the SDK Context and enhancing error types with structured resource identification fields. This establishes foundational patterns for cancellation, timeouts, and richer error diagnostics.
todos:
  - id: 4.1-context-field
    content: Add context.Context field to stigmer.Context struct
    status: completed
  - id: 4.1-accessor-methods
    content: Add Context(), WithValue(), Value(), Done(), Err() methods
    status: completed
  - id: 4.1-run-with-context
    content: Add RunWithContext() function and update Run() to use it
    status: completed
  - id: 4.1-constructors
    content: Add NewContextWithContext() and update newContext() constructors
    status: completed
  - id: 4.2-resource-error
    content: Add ResourceError type with constructors to internal/validation/errors.go
    status: completed
  - id: 4.2-synthesis-error
    content: Add SynthesisError type with constructors
    status: completed
  - id: 4.2-package-aliases
    content: Export new error types from agent and workflow packages
    status: completed
  - id: 4.2-update-synthesis
    content: Update Context synthesis methods to use new error types
    status: completed
  - id: verify-build
    content: Verify go build ./... passes and backward compatibility maintained
    status: completed
isProject: false
---

# Phase 4: Pulumi Pattern Adoption

## Overview

This phase enhances the Stigmer SDK with two critical patterns from the Pulumi SDK:

1. **context.Context integration** - Enables cancellation, timeouts, and request-scoped values
2. **Enhanced error types** - Adds resource identification for better diagnostics

Both changes maintain full backward compatibility with existing code.

---

## Task 4.1: Add context.Context Support to SDK Context

### Rationale

The Go standard library's `context.Context` is the idiomatic way to handle:

- **Cancellation** - Stop long-running operations gracefully
- **Timeouts/Deadlines** - Bound operation duration
- **Request-scoped values** - Pass metadata through call chains

Currently, `stigmer.Context` has no `context.Context` integration. Pulumi's pattern embeds `context.Context` directly:

```go
// Pulumi pattern (sdk/go/pulumi/context.go:89-93)
type Context struct {
    state *contextState
    ctx   context.Context  // Embedded Go context
    Log   Log
}
```

### Implementation

#### 4.1.1: Modify Context struct

File: [sdk/go/stigmer/context.go](sdk/go/stigmer/context.go)

Add `context.Context` field to the Context struct:

```go
type Context struct {
    // ctx is the underlying Go context for cancellation and values.
    // This follows the Pulumi pattern of embedding context.Context.
    ctx context.Context

    // variables stores all context variables by name
    variables map[string]Ref
    
    // ... rest of existing fields unchanged
}
```

#### 4.1.2: Add Context accessor methods

Add methods following Pulumi's pattern:

```go
// Context returns the underlying Go context.Context.
// Use this when you need to pass a context to external libraries
// or for cancellation-aware operations.
//
// Example:
//     ctx := stigmerCtx.Context()
//     result, err := http.NewRequestWithContext(ctx, "GET", url, nil)
func (c *Context) Context() context.Context {
    return c.ctx
}

// WithValue returns a new Context with the key-value pair added.
// The returned Context shares state with the original but has
// an extended context.Context.
//
// Example:
//     ctx = ctx.WithValue("requestID", "abc-123")
func (c *Context) WithValue(key, val any) *Context {
    return &Context{
        ctx:          context.WithValue(c.ctx, key, val),
        variables:    c.variables,
        workflows:    c.workflows,
        agents:       c.agents,
        dependencies: c.dependencies,
        mu:           c.mu,
        synthesized:  c.synthesized,
    }
}

// Value returns the value associated with key from the underlying context.
//
// Example:
//     reqID := ctx.Value("requestID").(string)
func (c *Context) Value(key any) any {
    return c.ctx.Value(key)
}

// Done returns a channel that's closed when the context is cancelled.
// This is a convenience method equivalent to ctx.Context().Done().
func (c *Context) Done() <-chan struct{} {
    return c.ctx.Done()
}

// Err returns the error explaining why Done() was closed.
// Returns nil if Done() is not yet closed.
func (c *Context) Err() error {
    return c.ctx.Err()
}
```

#### 4.1.3: Add RunWithContext function

Add a new entry point that accepts a parent context:

```go
// RunWithContext executes a function with a Context derived from the given
// parent context.Context. This enables cancellation, timeouts, and
// request-scoped values.
//
// Example with timeout:
//     ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
//     defer cancel()
//     err := stigmer.RunWithContext(ctx, func(ctx *stigmer.Context) error {
//         // Operations will be cancelled after 30 seconds
//         return nil
//     })
//
// Example with cancellation:
//     ctx, cancel := context.WithCancel(context.Background())
//     go func() {
//         <-signalChan
//         cancel()  // Cancel on signal
//     }()
//     err := stigmer.RunWithContext(ctx, func(ctx *stigmer.Context) error {
//         // Check ctx.Err() or ctx.Done() for cancellation
//         return nil
//     })
func RunWithContext(ctx context.Context, fn func(*Context) error) error {
    if ctx == nil {
        ctx = context.Background()
    }
    
    sCtx := newContextWithContext(ctx)
    
    // Execute the user function
    if err := fn(sCtx); err != nil {
        return fmt.Errorf("context function failed: %w", err)
    }
    
    // Check if context was cancelled before synthesis
    if err := ctx.Err(); err != nil {
        return fmt.Errorf("context cancelled before synthesis: %w", err)
    }
    
    // Synthesize all resources
    if err := sCtx.Synthesize(); err != nil {
        return fmt.Errorf("synthesis failed: %w", err)
    }
    
    return nil
}
```

#### 4.1.4: Update constructors

Update internal constructors to accept context:

```go
// newContextWithContext creates a new Context with the given Go context.
func newContextWithContext(ctx context.Context) *Context {
    return &Context{
        ctx:          ctx,
        variables:    make(map[string]Ref),
        workflows:    make([]*workflow.Workflow, 0),
        agents:       make([]*agent.Agent, 0),
        dependencies: make(map[string][]string),
    }
}

// newContext creates a new Context instance with a background context.
func newContext() *Context {
    return newContextWithContext(context.Background())
}

// NewContext creates a new Context instance for testing or advanced use cases.
// The returned Context uses context.Background() as its underlying context.
func NewContext() *Context {
    return newContext()
}

// NewContextWithContext creates a new Context with a custom Go context.
// This is useful for testing cancellation behavior or passing request-scoped values.
//
// Example:
//     ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
//     defer cancel()
//     sCtx := stigmer.NewContextWithContext(ctx)
func NewContextWithContext(ctx context.Context) *Context {
    if ctx == nil {
        ctx = context.Background()
    }
    return newContextWithContext(ctx)
}
```

#### 4.1.5: Update Run() for backward compatibility

Keep `Run()` working exactly as before:

```go
// Run executes a function with a new Context and automatically handles synthesis.
// This uses context.Background() internally. For cancellation or timeout support,
// use RunWithContext instead.
func Run(fn func(*Context) error) error {
    return RunWithContext(context.Background(), fn)
}
```

#### 4.1.6: Update imports

Add `context` import to [sdk/go/stigmer/context.go](sdk/go/stigmer/context.go):

```go
import (
    "context"      // Add this
    "encoding/json"
    "fmt"
    // ... rest unchanged
)
```

---

## Task 4.2: Enhance Error Types with Structured Fields

### Rationale

Current error types provide field-level context but lack resource identification. When an error occurs during synthesis of multiple resources, users need to know:

- **Which resource** failed (agent, workflow, etc.)
- **What operation** failed (creation, conversion, validation)
- **Where** in the resource the error occurred

Pulumi's pattern includes resource URNs in errors. Stigmer should include resource type and name.

### Implementation

#### 4.2.1: Add ResourceError type

File: [sdk/go/internal/validation/errors.go](sdk/go/internal/validation/errors.go)

Add a new error type for resource-level errors:

```go
// ResourceError represents an error associated with a specific Stigmer resource.
// It provides context about which resource failed and during what operation.
//
// Example:
//     err := &ResourceError{
//         ResourceType: "Agent",
//         ResourceName: "code-reviewer",
//         Operation:    "validation",
//         Message:      "missing required instructions",
//         Err:          ErrRequired,
//     }
type ResourceError struct {
    ResourceType string // The type of resource (e.g., "Agent", "Workflow")
    ResourceName string // The name of the resource (e.g., "code-reviewer")
    Operation    string // The operation that failed (e.g., "validation", "synthesis", "conversion")
    Message      string // Human-readable error message
    Err          error  // Underlying error for unwrapping
}

// Error implements the error interface.
func (e *ResourceError) Error() string {
    if e.ResourceName != "" {
        return fmt.Sprintf("%s %q %s failed: %s", 
            e.ResourceType, e.ResourceName, e.Operation, e.Message)
    }
    return fmt.Sprintf("%s %s failed: %s", e.ResourceType, e.Operation, e.Message)
}

// Unwrap returns the underlying error.
func (e *ResourceError) Unwrap() error {
    return e.Err
}

// Is implements error matching.
func (e *ResourceError) Is(target error) bool {
    if e.Err == nil {
        return false
    }
    return errors.Is(e.Err, target)
}

// WithField returns a new error with additional field context.
// This creates a ValidationError with the resource context preserved.
func (e *ResourceError) WithField(field, value, rule string) *ValidationError {
    return &ValidationError{
        Field:   fmt.Sprintf("%s.%s", strings.ToLower(e.ResourceType), field),
        Value:   truncateValue(value),
        Rule:    rule,
        Message: e.Message,
        Err:     e.Err,
    }
}
```

#### 4.2.2: Add ResourceError constructors

```go
// NewResourceError creates a new resource error.
func NewResourceError(resourceType, resourceName, operation, message string) *ResourceError {
    return &ResourceError{
        ResourceType: resourceType,
        ResourceName: resourceName,
        Operation:    operation,
        Message:      message,
    }
}

// NewResourceErrorWithCause creates a new resource error with an underlying cause.
func NewResourceErrorWithCause(resourceType, resourceName, operation, message string, err error) *ResourceError {
    return &ResourceError{
        ResourceType: resourceType,
        ResourceName: resourceName,
        Operation:    operation,
        Message:      message,
        Err:          err,
    }
}

// ResourceErrorf creates a new resource error with a formatted message.
func ResourceErrorf(resourceType, resourceName, operation, format string, args ...any) *ResourceError {
    return &ResourceError{
        ResourceType: resourceType,
        ResourceName: resourceName,
        Operation:    operation,
        Message:      fmt.Sprintf(format, args...),
    }
}
```

#### 4.2.3: Add SynthesisError type

Add a dedicated type for synthesis-phase errors:

```go
// SynthesisError represents an error during the synthesis phase.
// It wraps errors that occur when converting SDK types to protobuf
// or writing manifests to disk.
//
// Sentinel errors for synthesis operations:
var (
    ErrSynthesisAlreadyDone = errors.New("synthesis already performed")
    ErrSynthesisFailed      = errors.New("synthesis failed")
    ErrManifestWrite        = errors.New("failed to write manifest")
)

type SynthesisError struct {
    Phase        string         // The synthesis phase (e.g., "agents", "workflows", "dependencies")
    ResourceType string         // Optional: the type of resource being synthesized
    ResourceName string         // Optional: the name of the resource
    Message      string         // Human-readable error message
    Err          error          // Underlying error
}

// Error implements the error interface.
func (e *SynthesisError) Error() string {
    var b strings.Builder
    b.WriteString("synthesis")
    if e.Phase != "" {
        b.WriteString(" [")
        b.WriteString(e.Phase)
        b.WriteString("]")
    }
    if e.ResourceType != "" {
        b.WriteString(" ")
        b.WriteString(e.ResourceType)
        if e.ResourceName != "" {
            b.WriteString(" ")
            b.WriteString(strconv.Quote(e.ResourceName))
        }
    }
    b.WriteString(" failed: ")
    b.WriteString(e.Message)
    return b.String()
}

// Unwrap returns the underlying error.
func (e *SynthesisError) Unwrap() error {
    return e.Err
}

// NewSynthesisError creates a new synthesis error.
func NewSynthesisError(phase, message string) *SynthesisError {
    return &SynthesisError{
        Phase:   phase,
        Message: message,
        Err:     ErrSynthesisFailed,
    }
}

// NewSynthesisErrorForResource creates a synthesis error for a specific resource.
func NewSynthesisErrorForResource(phase, resourceType, resourceName, message string, err error) *SynthesisError {
    return &SynthesisError{
        Phase:        phase,
        ResourceType: resourceType,
        ResourceName: resourceName,
        Message:      message,
        Err:          err,
    }
}
```

#### 4.2.4: Add imports

Add `strings` and `strconv` imports:

```go
import (
    "errors"
    "fmt"
    "strconv"  // Add
    "strings"  // Add
)
```

#### 4.2.5: Export new types from package aliases

File: [sdk/go/agent/errors.go](sdk/go/agent/errors.go)

Add aliases for the new error types:

```go
// ResourceError is an alias to the shared resource error type.
type ResourceError = validation.ResourceError

// NewResourceError creates a new resource error for an agent.
func NewResourceError(name, operation, message string) *ResourceError {
    return validation.NewResourceError("Agent", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for an agent with a cause.
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
    return validation.NewResourceErrorWithCause("Agent", name, operation, message, err)
}
```

File: [sdk/go/workflow/errors.go](sdk/go/workflow/errors.go)

Add similar aliases:

```go
// ResourceError is an alias to the shared resource error type.
type ResourceError = validation.ResourceError

// NewResourceError creates a new resource error for a workflow.
func NewResourceError(name, operation, message string) *ResourceError {
    return validation.NewResourceError("Workflow", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for a workflow with a cause.
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
    return validation.NewResourceErrorWithCause("Workflow", name, operation, message, err)
}
```

#### 4.2.6: Update Context synthesis errors

File: [sdk/go/stigmer/context.go](sdk/go/stigmer/context.go)

Update synthesis methods to use the new error types:

```go
// In synthesizeAgents:
if err != nil {
    return validation.NewSynthesisErrorForResource(
        "agents", "Agent", ag.Name,
        fmt.Sprintf("failed to convert to proto: %v", err), err)
}

// In synthesizeWorkflows:
if err != nil {
    return validation.NewSynthesisErrorForResource(
        "workflows", "Workflow", wf.Document.Name,
        fmt.Sprintf("failed to convert to proto: %v", err), err)
}
```

---

## Files to Modify

| File | Changes |

|------|---------|

| [sdk/go/stigmer/context.go](sdk/go/stigmer/context.go) | Add context.Context field, accessor methods, RunWithContext, update constructors |

| [sdk/go/internal/validation/errors.go](sdk/go/internal/validation/errors.go) | Add ResourceError, SynthesisError types with constructors |

| [sdk/go/agent/errors.go](sdk/go/agent/errors.go) | Add ResourceError alias and agent-specific constructors |

| [sdk/go/workflow/errors.go](sdk/go/workflow/errors.go) | Add ResourceError alias and workflow-specific constructors |

---

## Design Principles

1. **Backward Compatibility**: All existing APIs continue to work unchanged
2. **Pulumi Alignment**: Follow established patterns from the Pulumi SDK
3. **Composability**: New error types can wrap existing errors
4. **Type Safety**: Strong typing for resource types and operations
5. **Diagnostics**: Rich context for debugging and logging
6. **Idiomatic Go**: Follow Go conventions for context and error handling

---

## Verification

After implementation, verify:

1. `go build ./...` passes in sdk/go
2. Existing code using `stigmer.Run()` works without changes
3. New `RunWithContext()` accepts cancellation
4. Error types include resource identification
5. `errors.Is()` and `errors.As()` work correctly