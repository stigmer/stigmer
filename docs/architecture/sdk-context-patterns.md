# SDK Context Patterns

**Status**: Implemented (Phase 4)  
**Date**: 2026-01-26  
**Pattern Source**: Pulumi SDK

---

## Overview

The Stigmer SDK Context now embeds Go's `context.Context` to enable:
- **Cancellation** - Stop long-running operations gracefully
- **Timeouts** - Bound operation duration
- **Request-scoped values** - Pass metadata through call chains

This pattern follows Pulumi's proven approach and aligns with Go best practices for context propagation.

---

## Architecture

### Context Structure

```go
// sdk/go/stigmer/context.go
type Context struct {
    // ctx is the underlying Go context for cancellation and values
    ctx context.Context
    
    // SDK-specific fields
    variables map[string]Ref
    resources []Resource
    outputDir string
    synthesized bool
}
```

**Design Decision**: Embed `context.Context` as a field (not anonymous embedding) to maintain control over the API surface.

### Core Methods

#### Context Accessor
```go
// Context returns the underlying Go context.Context
func (c *Context) Context() context.Context {
    return c.ctx
}
```

**Use Case**: Pass to external libraries that expect `context.Context`:
```go
// Example: HTTP client with SDK context
httpClient.Do(req.WithContext(sdkCtx.Context()))
```

#### Context Propagation
```go
// WithValue returns a new Context with key-value pair
func (c *Context) WithValue(key, val interface{}) *Context {
    newCtx := *c  // Shallow copy
    newCtx.ctx = context.WithValue(c.ctx, key, val)
    return &newCtx
}

// Value returns the value associated with key
func (c *Context) Value(key interface{}) interface{} {
    return c.ctx.Value(key)
}
```

**Use Case**: Request-scoped metadata (tracing, logging):
```go
ctx = ctx.WithValue("request_id", "req-123")
requestID := ctx.Value("request_id").(string)
```

#### Cancellation Checking
```go
// Done returns a channel closed when Context is cancelled
func (c *Context) Done() <-chan struct{} {
    return c.ctx.Done()
}

// Err returns the cancellation error
func (c *Context) Err() error {
    return c.ctx.Err()
}
```

**Use Case**: Check for cancellation during long operations:
```go
select {
case <-ctx.Done():
    return ctx.Err()  // context.Canceled or context.DeadlineExceeded
default:
    // Continue processing
}
```

---

## Entry Points

### RunWithContext (Context-Aware)

```go
// RunWithContext runs a function with cancellation/timeout support
func RunWithContext(ctx context.Context, fn func(*Context) error) error {
    sctx := NewContextWithContext(ctx)
    return fn(sctx)
}
```

**Primary entry point** for context-aware operations.

### Run (Backward Compatible)

```go
// Run delegates to RunWithContext with Background context
func Run(fn func(*Context) error) error {
    return RunWithContext(context.Background(), fn)
}
```

**Backward compatibility**: Existing code continues to work unchanged.

---

## Usage Patterns

### Pattern 1: Timeout Protection

**Use Case**: Prevent indefinite hangs in synthesis operations.

```go
func synthesizeWithTimeout() error {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        agent.New(sctx, "researcher", &agent.AgentArgs{
            Instructions: "Research topics",
        })
        return nil
    })
    
    if errors.Is(err, context.DeadlineExceeded) {
        return fmt.Errorf("synthesis timed out after 30s")
    }
    return err
}
```

**Benefits**:
- Bounds operation duration
- Prevents resource exhaustion
- Provides clear timeout errors

### Pattern 2: Graceful Cancellation

**Use Case**: Allow users to cancel operations (e.g., Ctrl+C).

```go
func synthesizeWithCancellation() error {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    // Handle Ctrl+C
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-sigChan
        fmt.Println("\nCancelling synthesis...")
        cancel()
    }()
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        // Periodically check for cancellation
        for _, resource := range resources {
            select {
            case <-sctx.Done():
                return sctx.Err()  // Return context.Canceled
            default:
            }
            
            // Process resource
            if err := processResource(resource); err != nil {
                return err
            }
        }
        return nil
    })
    
    if errors.Is(err, context.Canceled) {
        fmt.Println("Synthesis was cancelled by user")
        return nil  // Exit gracefully
    }
    return err
}
```

**Benefits**:
- Responsive to user interrupts
- Clean shutdown
- Resources properly released

### Pattern 3: Request-Scoped Values

**Use Case**: Pass metadata for tracing, logging, or correlation.

```go
func synthesizeWithTracing(requestID string) error {
    ctx := context.WithValue(context.Background(), "request_id", requestID)
    ctx = context.WithValue(ctx, "user_id", "user-123")
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        // Extract metadata for logging
        reqID := sctx.Value("request_id").(string)
        userID := sctx.Value("user_id").(string)
        
        log.Printf("[%s] User %s: Starting agent synthesis", reqID, userID)
        
        agent.New(sctx, "researcher", &agent.AgentArgs{
            Instructions: "Research topics",
        })
        
        log.Printf("[%s] Agent synthesis complete", reqID)
        return nil
    })
    
    return err
}
```

**Benefits**:
- Correlation across operations
- Structured logging
- Distributed tracing support

### Pattern 4: Combined Timeout + Cancellation

**Use Case**: Comprehensive operation control.

```go
func synthesizeWithFullControl() error {
    // Base context with timeout
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
    defer cancel()
    
    // Add cancellation signal handling
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, os.Interrupt)
    go func() {
        <-sigChan
        cancel()  // Cancel on signal
    }()
    
    // Add request metadata
    ctx = context.WithValue(ctx, "request_id", uuid.New().String())
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        reqID := sctx.Value("request_id").(string)
        
        for i, resource := range resources {
            // Check for cancellation/timeout
            select {
            case <-sctx.Done():
                log.Printf("[%s] Cancelled at resource %d/%d",
                    reqID, i, len(resources))
                return sctx.Err()
            default:
            }
            
            if err := processResource(resource); err != nil {
                return err
            }
        }
        return nil
    })
    
    // Handle different error types
    switch {
    case errors.Is(err, context.DeadlineExceeded):
        fmt.Println("Synthesis timed out")
    case errors.Is(err, context.Canceled):
        fmt.Println("Synthesis was cancelled")
    case err != nil:
        fmt.Printf("Synthesis failed: %v\n", err)
    }
    
    return err
}
```

**Benefits**:
- Timeout protection
- User cancellation
- Request tracing
- Comprehensive error handling

---

## Comparison with Pulumi

### Pulumi Pattern

```go
// Pulumi's Context (simplified)
type Context struct {
    state *contextState
    ctx   context.Context  // Embedded context
    Log   Log
}

func (ctx *Context) Context() context.Context {
    return ctx.ctx
}
```

### Stigmer Adaptation

```go
// Stigmer's Context (same pattern)
type Context struct {
    ctx       context.Context  // Embedded context (Pulumi pattern)
    variables map[string]Ref
    resources []Resource
    outputDir string
}

func (c *Context) Context() context.Context {
    return c.ctx
}
```

**Key Similarity**: Both embed `context.Context` and provide accessor methods.

**Difference**: Stigmer focuses on synthesis operations, Pulumi on infrastructure deployment. The pattern adapts to different domains while maintaining the core benefits.

---

## Design Decisions

### Decision 1: Field Embedding (Not Anonymous)

**Chosen**:
```go
type Context struct {
    ctx context.Context  // Named field
}
```

**Alternative**:
```go
type Context struct {
    context.Context  // Anonymous embedding
}
```

**Rationale**: 
- Named field provides explicit control over API surface
- Prevents accidental exposure of all context.Context methods
- Clear distinction between SDK context and Go context
- Follows Pulumi's pattern

### Decision 2: Delegation Methods

**Chosen**: Provide explicit accessor methods (`Context()`, `Done()`, `Err()`, `WithValue()`, `Value()`)

**Alternative**: Rely on users calling `ctx.Context()` for everything

**Rationale**:
- More ergonomic for common operations
- Clearer intent (e.g., `ctx.Done()` vs `ctx.Context().Done()`)
- Better IDE autocomplete experience
- Consistent with Pulumi SDK

### Decision 3: Backward Compatibility via Delegation

**Chosen**: `Run()` delegates to `RunWithContext(context.Background(), fn)`

**Alternative**: Break existing code, require `RunWithContext()` everywhere

**Rationale**:
- Maintains backward compatibility
- Existing code works unchanged
- Gradual migration path
- No forced breaking changes

### Decision 4: NewContextWithContext Constructor

**Chosen**: Explicit constructor for context-aware usage

```go
func NewContextWithContext(ctx context.Context) *Context
```

**Rationale**:
- Clear intent when creating context-aware contexts
- Explicit over implicit
- Standard Go naming convention

---

## Migration Guide

### For Existing Code (No Changes Required)

```go
// This continues to work unchanged
err := stigmer.Run(func(ctx *stigmer.Context) error {
    agent.New(ctx, "name", &agent.AgentArgs{...})
    return nil
})
```

**No migration needed** - existing code is fully compatible.

### For New Context-Aware Code

```go
// Add timeout support
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
    agent.New(sctx, "name", &agent.AgentArgs{...})
    return nil
})
```

**Opt-in**: Use `RunWithContext()` when you need cancellation/timeout support.

---

## Best Practices

### DO: Check for Cancellation in Long Operations

```go
stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
    for _, item := range manyItems {
        select {
        case <-sctx.Done():
            return sctx.Err()
        default:
        }
        // Process item
    }
    return nil
})
```

### DO: Use Timeouts for Network Operations

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
    // Network-dependent synthesis
    return nil
})
```

### DO: Add Request IDs for Tracing

```go
ctx := context.WithValue(context.Background(), "request_id", uuid.New())

stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
    reqID := sctx.Value("request_id")
    log.Printf("[%s] Starting synthesis", reqID)
    return nil
})
```

### DON'T: Store Context in Struct

```go
// BAD
type MySynthesizer struct {
    ctx *stigmer.Context  // Don't store context
}

// GOOD - Pass as parameter
func (s *MySynthesizer) Synthesize(ctx *stigmer.Context) error {
    // Use context as parameter
}
```

### DON'T: Ignore Context Errors

```go
// BAD
select {
case <-ctx.Done():
    return nil  // Ignores context error
default:
}

// GOOD
select {
case <-ctx.Done():
    return ctx.Err()  // Return proper error
default:
}
```

---

## Testing Context-Aware Code

### Test Timeout Behavior

```go
func TestSynthesisTimeout(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
    defer cancel()
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        time.Sleep(100 * time.Millisecond)  // Simulate slow operation
        return nil
    })
    
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Errorf("Expected timeout error, got: %v", err)
    }
}
```

### Test Cancellation

```go
func TestSynthesisCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    
    started := make(chan struct{})
    var err error
    
    go func() {
        err = stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
            close(started)
            <-sctx.Done()  // Block until cancelled
            return sctx.Err()
        })
    }()
    
    <-started  // Wait for synthesis to start
    cancel()   // Cancel it
    
    time.Sleep(10 * time.Millisecond)  // Allow goroutine to finish
    
    if !errors.Is(err, context.Canceled) {
        t.Errorf("Expected cancellation error, got: %v", err)
    }
}
```

### Test Request-Scoped Values

```go
func TestContextValues(t *testing.T) {
    requestID := "req-123"
    ctx := context.WithValue(context.Background(), "request_id", requestID)
    
    var extractedID string
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        extractedID = sctx.Value("request_id").(string)
        return nil
    })
    
    if err != nil {
        t.Fatalf("Unexpected error: %v", err)
    }
    
    if extractedID != requestID {
        t.Errorf("Expected request_id %s, got %s", requestID, extractedID)
    }
}
```

---

## Future Enhancements

### Potential Improvements

1. **Context-Aware Resource Operations**
   - Check `ctx.Done()` during resource synthesis
   - Enable incremental cancellation (partial synthesis)

2. **Progress Reporting**
   - Use context values for progress callbacks
   - Stream synthesis progress to UI

3. **Distributed Tracing Integration**
   - OpenTelemetry span propagation via context
   - Automatic trace ID injection

4. **Retry Policies**
   - Use context deadlines for retry timeouts
   - Exponential backoff with context awareness

---

## Related Documentation

- **Implementation**: `sdk/go/stigmer/context.go`
- **Audit Report**: `docs/audit-reports/sdk-codegen-review-2026-01/phase-4-pulumi-patterns.md`
- **Error Types**: `docs/architecture/sdk-error-types.md`
- **Pulumi Reference**: Pulumi SDK documentation on Context patterns

---

## References

- **Go Context Package**: https://pkg.go.dev/context
- **Go Blog - Context**: https://go.dev/blog/context
- **Pulumi Context**: Pulumi SDK source code (`sdk/go/pulumi/context.go`)

---

**Summary**: The Stigmer SDK now provides production-grade context support through `context.Context` embedding, following Pulumi's proven pattern. This enables cancellation, timeouts, and request-scoped values while maintaining full backward compatibility with existing code.
