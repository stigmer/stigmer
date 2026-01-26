# SDK Error Types

**Status**: Implemented (Phase 4)  
**Date**: 2026-01-26  
**Pattern Source**: Pulumi SDK (structured errors)

---

## Overview

The Stigmer SDK provides structured error types with resource identification to improve debugging and programmatic error handling. This addresses the common problem of generic error messages that don't identify which resource failed.

---

## Problem Statement

### Before: Generic Errors

```go
// Generic error messages
return fmt.Errorf("synthesis failed: %w", err)
return fmt.Errorf("validation error: %w", err)
```

**Issues**:
- Which resource failed? Unknown.
- Can't programmatically extract resource info
- Hard to debug multi-resource synthesis
- No structured error handling

**Example**:
```
synthesis failed: validation error
```

When synthesizing 10 agents and 5 workflows, this error doesn't tell you:
- Was it an agent or workflow?
- Which specific resource?
- What operation failed?

### After: Structured Errors

```go
// Structured error with resource context
return agent.NewResourceError("Agent", "researcher", "validation", err)
```

**Benefits**:
- Clear resource identification
- Programmatic error extraction
- Better debugging
- Structured error handling

**Example**:
```
Agent "researcher" validation failed: invalid name format
```

Now you know exactly what failed.

---

## Error Types

### 1. ResourceError

**Purpose**: Errors associated with a specific resource operation.

**Structure**:
```go
type ResourceError struct {
    ResourceType string  // e.g., "Agent", "Workflow", "Skill"
    ResourceName string  // e.g., "researcher", "pipeline"
    Operation    string  // e.g., "validation", "synthesis", "conversion"
    Err          error   // Underlying error
}
```

**Methods**:
```go
// Error implements error interface
func (e *ResourceError) Error() string {
    return fmt.Sprintf("%s %q %s failed: %v",
        e.ResourceType, e.ResourceName, e.Operation, e.Err)
}

// Unwrap enables errors.Is and errors.As
func (e *ResourceError) Unwrap() error {
    return e.Err
}
```

**Constructor**:
```go
// NewResourceError creates a ResourceError (returns nil if err is nil)
func NewResourceError(resourceType, resourceName, operation string, err error) error {
    if err == nil {
        return nil
    }
    return &ResourceError{
        ResourceType: resourceType,
        ResourceName: resourceName,
        Operation:    operation,
        Err:          err,
    }
}
```

**Usage Example**:
```go
// In SDK validation code
if err := validateAgentName(name); err != nil {
    return agent.NewResourceError("Agent", name, "validation", err)
}

// Error message:
// Agent "researcher" validation failed: name must start with lowercase letter
```

### 2. SynthesisError

**Purpose**: Errors during synthesis phase with optional resource context.

**Structure**:
```go
type SynthesisError struct {
    Phase        string  // e.g., "resource collection", "manifest write"
    ResourceType string  // e.g., "Agent" (optional)
    ResourceName string  // e.g., "researcher" (optional)
    Err          error   // Underlying error
}
```

**Methods**:
```go
// Error implements error interface
func (e *SynthesisError) Error() string {
    if e.ResourceType != "" && e.ResourceName != "" {
        return fmt.Sprintf("synthesis failed in %s phase for %s %q: %v",
            e.Phase, e.ResourceType, e.ResourceName, e.Err)
    }
    return fmt.Sprintf("synthesis failed in %s phase: %v", e.Phase, e.Err)
}

// Unwrap enables errors.Is and errors.As
func (e *SynthesisError) Unwrap() error {
    return e.Err
}
```

**Constructors**:
```go
// NewSynthesisError - generic phase error
func NewSynthesisError(phase string, err error) error {
    if err == nil {
        return nil
    }
    return &SynthesisError{
        Phase: phase,
        Err:   err,
    }
}

// NewSynthesisErrorWithResource - resource-specific phase error
func NewSynthesisErrorWithResource(phase, resourceType, resourceName string, err error) error {
    if err == nil {
        return nil
    }
    return &SynthesisError{
        Phase:        phase,
        ResourceType: resourceType,
        ResourceName: resourceName,
        Err:          err,
    }
}
```

**Usage Examples**:

**Generic Synthesis Error**:
```go
if err := writeManifest(manifest); err != nil {
    return agent.NewSynthesisError("manifest write", err)
}

// Error message:
// synthesis failed in manifest write phase: file write error
```

**Resource-Specific Synthesis Error**:
```go
if err := synthesizeAgent(agent); err != nil {
    return agent.NewSynthesisErrorWithResource("synthesis", "Agent", agent.Name, err)
}

// Error message:
// synthesis failed in synthesis phase for Agent "researcher": proto conversion failed
```

### 3. Sentinel Errors

**Purpose**: Common errors that can be checked with `errors.Is()`.

**Defined Errors**:
```go
var (
    // ErrSynthesisAlreadyDone indicates synthesis was already completed
    ErrSynthesisAlreadyDone = errors.New("synthesis already done")
    
    // ErrSynthesisFailed indicates a synthesis operation failed
    ErrSynthesisFailed = errors.New("synthesis failed")
    
    // ErrManifestWrite indicates manifest write operation failed
    ErrManifestWrite = errors.New("manifest write failed")
)
```

**Usage Example**:
```go
err := ctx.Synthesize()

if errors.Is(err, agent.ErrSynthesisAlreadyDone) {
    fmt.Println("Synthesis was already completed")
    return nil  // Not an error
}
```

---

## Package Structure

### Internal Implementation

**File**: `sdk/go/internal/validation/errors.go`

Contains implementations of:
- `ResourceError` type
- `SynthesisError` type
- Constructor functions
- Sentinel errors

**Rationale**: Keep implementation details internal.

### Public Exports

**Files**: 
- `sdk/go/agent/errors.go`
- `sdk/go/workflow/errors.go`

Export error types via type aliases:

```go
// sdk/go/agent/errors.go
package agent

import "stigmer/sdk/go/internal/validation"

// Type aliases for external use
type ResourceError = validation.ResourceError
type SynthesisError = validation.SynthesisError

// Function aliases
var (
    NewResourceError              = validation.NewResourceError
    NewSynthesisError             = validation.NewSynthesisError
    NewSynthesisErrorWithResource = validation.NewSynthesisErrorWithResource
    ErrSynthesisAlreadyDone       = validation.ErrSynthesisAlreadyDone
    ErrSynthesisFailed            = validation.ErrSynthesisFailed
    ErrManifestWrite              = validation.ErrManifestWrite
)
```

**Benefits**:
- Public packages provide clean API
- Internal package keeps implementation details hidden
- Consistent error handling across agent and workflow packages

---

## Usage Patterns

### Pattern 1: Basic Resource Error

```go
func validateAgent(agent *Agent) error {
    if err := validateName(agent.Name); err != nil {
        return agent.NewResourceError("Agent", agent.Name, "validation", err)
    }
    
    if err := validateInstructions(agent.Instructions); err != nil {
        return agent.NewResourceError("Agent", agent.Name, "validation", err)
    }
    
    return nil
}

// Error output:
// Agent "researcher" validation failed: instructions cannot be empty
```

### Pattern 2: Error Extraction

```go
err := agent.New(ctx, "researcher", &agent.AgentArgs{...})

// Extract resource information programmatically
var resErr *agent.ResourceError
if errors.As(err, &resErr) {
    fmt.Printf("Resource Type: %s\n", resErr.ResourceType)
    fmt.Printf("Resource Name: %s\n", resErr.ResourceName)
    fmt.Printf("Operation: %s\n", resErr.Operation)
    fmt.Printf("Error: %v\n", resErr.Err)
    
    // Output:
    // Resource Type: Agent
    // Resource Name: researcher
    // Operation: validation
    // Error: invalid name format
}
```

### Pattern 3: Sentinel Error Checking

```go
err := ctx.Synthesize()

// Check for specific sentinel error
if errors.Is(err, agent.ErrSynthesisAlreadyDone) {
    fmt.Println("Synthesis was already completed - skipping")
    return nil
}

if errors.Is(err, agent.ErrManifestWrite) {
    fmt.Println("Failed to write manifest file")
    return err
}
```

### Pattern 4: Error Wrapping

```go
func synthesizeAgent(agent *Agent) error {
    // Validate first
    if err := validateAgent(agent); err != nil {
        // Already a ResourceError, just return it
        return err
    }
    
    // Convert to proto
    proto, err := agent.ToProto()
    if err != nil {
        // Wrap proto conversion error
        return agent.NewResourceError("Agent", agent.Name, "proto conversion", err)
    }
    
    return nil
}
```

### Pattern 5: Multi-Resource Error Handling

```go
func synthesizeAllResources(ctx *stigmer.Context) error {
    var errors []error
    
    for _, agent := range agents {
        if err := synthesizeAgent(agent); err != nil {
            // Each error has resource context
            errors = append(errors, err)
        }
    }
    
    for _, workflow := range workflows {
        if err := synthesizeWorkflow(workflow); err != nil {
            errors = append(errors, err)
        }
    }
    
    if len(errors) > 0 {
        // All errors have resource identification
        for _, err := range errors {
            fmt.Println(err)  // Each error identifies the resource
        }
        return fmt.Errorf("synthesis failed with %d errors", len(errors))
    }
    
    return nil
}

// Output:
// Agent "researcher" validation failed: invalid name format
// Workflow "pipeline" validation failed: missing tasks
// Agent "analyzer" proto conversion failed: nil instructions
```

---

## Best Practices

### DO: Always Provide Resource Context

```go
// GOOD
return agent.NewResourceError("Agent", agent.Name, "validation", err)

// BAD
return fmt.Errorf("validation failed: %w", err)
```

### DO: Use Descriptive Operation Names

```go
// GOOD - Clear operation names
NewResourceError("Agent", "researcher", "validation", err)
NewResourceError("Agent", "researcher", "proto conversion", err)
NewResourceError("Agent", "researcher", "synthesis", err)

// BAD - Vague operation names
NewResourceError("Agent", "researcher", "processing", err)
NewResourceError("Agent", "researcher", "error", err)
```

### DO: Check for nil Before Creating Error

```go
// GOOD - Constructor handles nil check
return agent.NewResourceError("Agent", name, "validation", err)  // Returns nil if err is nil

// No need for:
if err != nil {
    return agent.NewResourceError("Agent", name, "validation", err)
}
```

### DO: Use errors.As for Type Extraction

```go
// GOOD
var resErr *agent.ResourceError
if errors.As(err, &resErr) {
    // Handle resource error
}

// BAD - Type assertion without check
resErr := err.(*agent.ResourceError)  // Panics if wrong type
```

### DON'T: Wrap ResourceError in Generic Error

```go
// BAD - Loses structure
if err := validateAgent(agent); err != nil {
    return fmt.Errorf("agent validation failed: %w", err)
}

// GOOD - Keep ResourceError
if err := validateAgent(agent); err != nil {
    return err  // Already has context
}
```

---

## Testing Error Types

### Test ResourceError Creation

```go
func TestResourceError(t *testing.T) {
    baseErr := errors.New("invalid format")
    err := agent.NewResourceError("Agent", "researcher", "validation", baseErr)
    
    // Check error message
    expected := `Agent "researcher" validation failed: invalid format`
    if err.Error() != expected {
        t.Errorf("Expected %q, got %q", expected, err.Error())
    }
    
    // Check unwrapping
    if !errors.Is(err, baseErr) {
        t.Error("ResourceError should unwrap to base error")
    }
    
    // Check type assertion
    var resErr *agent.ResourceError
    if !errors.As(err, &resErr) {
        t.Error("Should be able to extract ResourceError")
    }
    
    if resErr.ResourceType != "Agent" {
        t.Errorf("Expected ResourceType 'Agent', got %q", resErr.ResourceType)
    }
}
```

### Test SynthesisError Creation

```go
func TestSynthesisError(t *testing.T) {
    baseErr := errors.New("file write failed")
    
    // Test generic synthesis error
    err := agent.NewSynthesisError("manifest write", baseErr)
    expected := "synthesis failed in manifest write phase: file write failed"
    if err.Error() != expected {
        t.Errorf("Expected %q, got %q", expected, err.Error())
    }
    
    // Test resource-specific synthesis error
    err2 := agent.NewSynthesisErrorWithResource("synthesis", "Agent", "researcher", baseErr)
    expected2 := `synthesis failed in synthesis phase for Agent "researcher": file write failed`
    if err2.Error() != expected2 {
        t.Errorf("Expected %q, got %q", expected2, err2.Error())
    }
}
```

### Test Sentinel Errors

```go
func TestSentinelErrors(t *testing.T) {
    err := agent.ErrSynthesisAlreadyDone
    
    // Test errors.Is
    if !errors.Is(err, agent.ErrSynthesisAlreadyDone) {
        t.Error("Should match sentinel error")
    }
    
    // Test error message
    expected := "synthesis already done"
    if err.Error() != expected {
        t.Errorf("Expected %q, got %q", expected, err.Error())
    }
}
```

### Test Error Extraction in Real Code

```go
func TestAgentValidationError(t *testing.T) {
    ctx := stigmer.NewContext()
    
    // Try to create agent with invalid name
    err := agent.New(ctx, "", &agent.AgentArgs{
        Instructions: "Test",
    })
    
    // Should get ResourceError
    var resErr *agent.ResourceError
    if !errors.As(err, &resErr) {
        t.Fatalf("Expected ResourceError, got %T", err)
    }
    
    // Check fields
    if resErr.ResourceType != "Agent" {
        t.Errorf("Expected ResourceType 'Agent', got %q", resErr.ResourceType)
    }
    
    if resErr.Operation != "validation" {
        t.Errorf("Expected Operation 'validation', got %q", resErr.Operation)
    }
}
```

---

## Error Type Decision Tree

```
Is it a resource-specific error?
│
├─ YES: Is it during synthesis?
│   │
│   ├─ YES: Use SynthesisErrorWithResource
│   │   └─ agent.NewSynthesisErrorWithResource("synthesis", "Agent", name, err)
│   │
│   └─ NO: Use ResourceError
│       └─ agent.NewResourceError("Agent", name, "validation", err)
│
└─ NO: Is it a synthesis phase error?
    │
    ├─ YES: Use SynthesisError
    │   └─ agent.NewSynthesisError("manifest write", err)
    │
    └─ NO: Is it a common condition?
        │
        ├─ YES: Use sentinel error
        │   └─ return agent.ErrSynthesisAlreadyDone
        │
        └─ NO: Use standard error
            └─ return fmt.Errorf("unexpected error: %w", err)
```

---

## Comparison: Before vs After

### Before (Generic)

```go
// Creating agent
func New(ctx Context, name string, args *AgentArgs) error {
    if err := validate(name); err != nil {
        return fmt.Errorf("validation failed: %w", err)
    }
    return nil
}

// User sees:
"validation failed: invalid name format"
// Which resource? Unknown.
```

### After (Structured)

```go
// Creating agent
func New(ctx Context, name string, args *AgentArgs) error {
    if err := validate(name); err != nil {
        return NewResourceError("Agent", name, "validation", err)
    }
    return nil
}

// User sees:
Agent "researcher" validation failed: invalid name format
// Clear: Agent named "researcher" failed validation.

// Programmatic extraction:
var resErr *ResourceError
if errors.As(err, &resErr) {
    log.Printf("Resource: %s %s, Operation: %s, Error: %v",
        resErr.ResourceType, resErr.ResourceName, resErr.Operation, resErr.Err)
}
```

---

## Integration with Context Patterns

Error types work seamlessly with context patterns:

```go
func synthesizeWithContextAndErrors() error {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    
    err := stigmer.RunWithContext(ctx, func(sctx *stigmer.Context) error {
        // Context cancellation
        select {
        case <-sctx.Done():
            return sctx.Err()  // context.Canceled or context.DeadlineExceeded
        default:
        }
        
        // Resource error
        if err := agent.New(sctx, "researcher", &agent.AgentArgs{...}); err != nil {
            return err  // ResourceError with full context
        }
        
        return nil
    })
    
    // Handle both error types
    switch {
    case errors.Is(err, context.DeadlineExceeded):
        fmt.Println("Synthesis timed out")
    case errors.Is(err, context.Canceled):
        fmt.Println("Synthesis was cancelled")
    default:
        var resErr *agent.ResourceError
        if errors.As(err, &resErr) {
            fmt.Printf("Resource error: %s %q failed during %s\n",
                resErr.ResourceType, resErr.ResourceName, resErr.Operation)
        }
    }
    
    return err
}
```

---

## Related Documentation

- **Implementation**: `sdk/go/internal/validation/errors.go`
- **Public Exports**: `sdk/go/agent/errors.go`, `sdk/go/workflow/errors.go`
- **Audit Report**: `docs/audit-reports/sdk-codegen-review-2026-01/phase-4-pulumi-patterns.md`
- **Context Patterns**: `docs/architecture/sdk-context-patterns.md`

---

## References

- **Go Error Handling**: https://go.dev/blog/go1.13-errors
- **errors.Is and errors.As**: https://pkg.go.dev/errors
- **Pulumi Error Patterns**: Pulumi SDK source code

---

**Summary**: The Stigmer SDK now provides structured error types (ResourceError, SynthesisError) with resource identification, enabling better debugging and programmatic error handling. All errors support Go 1.13+ error wrapping with `errors.Is()` and `errors.As()`.
