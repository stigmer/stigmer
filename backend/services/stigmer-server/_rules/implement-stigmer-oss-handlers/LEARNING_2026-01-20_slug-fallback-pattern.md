# Learning: Slug Fallback Pattern for Pipeline Steps

**Date**: 2026-01-20  
**Context**: Fixed LoadExistingStep to support apply operations with slug/name  
**Impact**: High - Enables all apply operations to work without ID requirement

---

## Problem Solved

Users got error "resource id is required for update" when using apply operations like:
```bash
stigmer deploy agent 'pr-reviewer'
```

**Root Cause**: LoadExistingStep only supported ID-based lookups, but Apply pipeline delegates with original input (without populated ID).

## Pattern: Fallback Lookup Strategy

### When to Use

Use fallback lookups in pipeline steps when:
- Multiple identifiers can reference a resource (ID, slug, name)
- Some callers may not have the primary identifier
- You want to support flexible input without breaking existing fast paths

### Implementation Pattern

```go
// Pattern: Try primary identifier first (fast path), fall back to secondary (slower)
func (s *LoadExistingStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    metadata := getMetadata(input)
    kind := getKind(ctx)
    
    var existing T

    // 1. Try primary identifier first (O(1) - fast path)
    if metadata.Id != "" {
        existing = proto.Clone(input).(T)
        if err := s.store.GetResource(ctx.Context(), kind, metadata.Id, existing); err != nil {
            return grpclib.NotFoundError(kindName, metadata.Id)
        }
    } 
    // 2. Fall back to secondary identifier (O(n) - acceptable for small datasets)
    else if metadata.Slug != "" {
        found, err := s.findBySlug(ctx.Context(), metadata.Slug, kind)
        if err != nil {
            return fmt.Errorf("failed to load resource by slug: %w", err)
        }
        if found == nil {
            return grpclib.NotFoundError(kindName, metadata.Slug)
        }
        existing = found.(T)
        
        // IMPORTANT: Populate primary identifier for downstream steps
        existingMetadata := existing.(HasMetadata).GetMetadata()
        metadata.Id = existingMetadata.Id  // Enrich input with ID
    } 
    // 3. Error if no identifier provided
    else {
        return grpclib.InvalidArgumentError("resource id or slug is required")
    }

    // Store in context for downstream steps
    ctx.Set(ExistingResourceKey, existing)
    return nil
}
```

### Key Principles

**1. Primary Path Unchanged**
```go
// Existing callers with ID continue to use O(1) lookup
if metadata.Id != "" {
    // Fast path - no performance regression
    return directLookup(id)
}
```

**2. Fallback is Opt-In**
```go
// Fallback only triggered when primary identifier absent
else if metadata.Slug != "" {
    // Slower path, but only used when necessary
    return slowLookup(slug)
}
```

**3. Enrich Input for Downstream**
```go
// When fallback finds resource, populate primary identifier
// This ensures subsequent steps have the fast identifier
metadata.Id = existingResource.Metadata.Id
```

**4. Clear Error Messages**
```go
// Different errors for different lookup methods
if notFoundById {
    return grpclib.NotFoundError("Agent", id)
}
if notFoundBySlug {
    return grpclib.NotFoundError("Agent", slug)
}
```

## Implementation: findBySlug

### BadgerDB/Local Storage Version

```go
// findBySlug searches for a resource by slug
// Returns the resource if found, nil if not found, error if database operation fails
func (s *LoadExistingStep[T]) findBySlug(
    ctx context.Context, 
    slug string, 
    kind apiresourcekind.ApiResourceKind,
) (proto.Message, error) {
    // Get all resources of this kind (O(n) operation)
    resources, err := s.store.ListResources(ctx, kind)
    if err != nil {
        return nil, fmt.Errorf("failed to list resources: %w", err)
    }

    // Scan through resources to find matching slug
    for _, data := range resources {
        // Create a new instance of T to unmarshal into
        var resource T
        resource = resource.ProtoReflect().New().Interface().(T)

        // Use proto.Unmarshal since stores return proto bytes
        if err := proto.Unmarshal(data, resource); err != nil {
            // Skip resources that can't be unmarshaled
            continue
        }

        // Check if this resource has the matching slug
        if metadataResource, ok := any(resource).(HasMetadata); ok {
            metadata := metadataResource.GetMetadata()
            if metadata != nil && metadata.Slug == slug {
                return resource, nil // Found!
            }
        }
    }

    return nil, nil // Not found
}
```

### Performance Characteristics

| Lookup Method | Complexity | When to Use | Notes |
|---------------|------------|-------------|-------|
| **By ID** | O(1) | Always prefer | Direct BadgerDB key lookup |
| **By Slug** | O(n) | Fallback only | Must scan and unmarshal all resources |

### Performance Acceptable For

- ✅ **Local development** (Stigmer OSS)
  - Typical dataset: 10-50 resources per kind
  - Expected performance: 5-10ms for 50 resources
  
- ✅ **Infrequent operations**
  - User-triggered apply operations
  - Not in hot path (not called per-request in API)

- ✅ **MVP without premature optimization**
  - Simpler code (no index maintenance)
  - Can add index later if needed (non-breaking)

### When to Add Secondary Index

Consider adding slug → ID index when:
- ❌ Users report slow apply operations
- ❌ Profiling shows slug lookups are bottleneck
- ❌ Resource counts consistently exceed 100 per kind
- ❌ Slug lookups happen frequently (API-driven, not user-driven)

**Index Implementation:**
```go
// When saving:
SaveResource(kind, id, proto)         // Primary: "agent/agent-123" → proto
SaveIndex(kind, "slug", slug, id)     // Secondary: "agent:slug:pr-reviewer" → "agent-123"

// When looking up by slug:
id := GetIndex(kind, "slug", slug)    // O(1) - get ID from index
proto := GetResource(kind, id)        // O(1) - get resource by ID
// Total: O(1) + O(1) = O(1)
```

## Pipeline State Management Insight

### The Delegation Problem

When one pipeline delegates to another, be careful about what state is passed:

```go
// Apply pipeline
func (c *Controller) Apply(ctx context.Context, input *Resource) (*Resource, error) {
    reqCtx := pipeline.NewRequestContext(ctx, input)
    
    // Execute pipeline - modifies reqCtx.NewState()
    p.Execute(reqCtx)
    
    // State is enriched in context
    enriched := reqCtx.NewState()  // Has ID populated
    
    // ❌ PROBLEM: Delegates with original input (not enriched state)
    if shouldUpdate {
        return c.Update(ctx, input)  // input doesn't have ID!
    }
}
```

### Solution: Make Receiving Pipeline Resilient

Don't assume input has all enriched state - support fallback:

```go
// Update pipeline's LoadExistingStep
func (s *LoadExistingStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    metadata := input.GetMetadata()
    
    // ✅ Resilient: Try ID first, fall back to slug
    if metadata.Id != "" {
        return s.loadById(metadata.Id)
    } else if metadata.Slug != "" {
        return s.loadBySlug(metadata.Slug)  // Handles missing ID gracefully
    }
}
```

### Alternative: Pass Context State

Could also pass enriched state explicitly:

```go
// Option: Pass enriched state instead of original input
if shouldUpdate {
    enriched := reqCtx.NewState()  // Get enriched state
    return c.Update(ctx, enriched)  // Pass enriched version
}
```

**Trade-offs:**
- ✅ Simpler (receiving pipeline gets everything)
- ❌ Less flexible (assumes pipeline enriched correctly)
- ❌ Tight coupling between pipelines

**Our approach** (fallback in receiving pipeline):
- ✅ More resilient (handles various input states)
- ✅ Loose coupling (pipelines independent)
- ✅ Backward compatible (existing callers unchanged)

## Reusable Patterns

### Pattern: Multi-Identifier Lookup

```go
// Generic pattern for supporting multiple identifiers
func (s *Step[T]) findResource(
    ctx context.Context,
    primary string,    // Fast lookup (O(1))
    secondary string,  // Fallback lookup (O(n))
) (T, error) {
    if primary != "" {
        return s.findByPrimary(ctx, primary)
    }
    if secondary != "" {
        resource, err := s.findBySecondary(ctx, secondary)
        if err == nil && resource != nil {
            // Enrich input with primary identifier
            enrichPrimaryIdentifier(resource, primary)
        }
        return resource, err
    }
    return nil, errors.New("identifier required")
}
```

### Pattern: Performance-Aware Fallback

```go
// Log when fallback path is used (for monitoring)
func (s *LoadExistingStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    metadata := input.GetMetadata()
    
    if metadata.Id != "" {
        // Fast path - silent
        return s.loadById(metadata.Id)
    } else if metadata.Slug != "" {
        // Fallback path - log for monitoring
        log.Debug().
            Str("slug", metadata.Slug).
            Msg("Using slug fallback (slower O(n) lookup)")
        return s.loadBySlug(metadata.Slug)
    }
    
    return grpclib.InvalidArgumentError("id or slug required")
}
```

### Pattern: Gradual Enrichment

```go
// Pattern: Enrich input as you go through pipeline
func (s *LoadExistingStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    input := ctx.Input()
    metadata := input.GetMetadata()
    
    // Load resource (by ID or slug)
    existing := s.loadResource(metadata)
    
    // Enrich input with missing identifiers
    if metadata.Id == "" {
        metadata.Id = existing.GetMetadata().Id  // Populate ID
    }
    if metadata.Slug == "" {
        metadata.Slug = existing.GetMetadata().Slug  // Populate slug
    }
    
    // Store in context for downstream steps
    ctx.Set(ExistingResourceKey, existing)
    
    return nil
}
```

## Testing Patterns

### Test Coverage for Fallback

```go
func TestLoadExistingStep_ByID(t *testing.T) {
    // Test fast path (O(1) lookup)
    resource := &pb.Agent{
        Metadata: &apiresource.ApiResourceMetadata{
            Id: "agent-123",  // ID provided
            Slug: "",         // Slug not needed
        },
    }
    
    // Should use fast ID lookup
    err := step.Execute(ctx)
    assert.NoError(t, err)
    assert.Equal(t, 1, store.GetResourceCallCount())  // Direct lookup
}

func TestLoadExistingStep_BySlug(t *testing.T) {
    // Test fallback path (O(n) lookup)
    resource := &pb.Agent{
        Metadata: &apiresource.ApiResourceMetadata{
            Id: "",              // No ID
            Slug: "pr-reviewer", // Slug provided
        },
    }
    
    // Should use slug fallback
    err := step.Execute(ctx)
    assert.NoError(t, err)
    assert.Equal(t, 1, store.ListResourcesCallCount())  // List + scan
    
    // Should populate ID after finding by slug
    assert.NotEmpty(t, resource.Metadata.Id)  // ID enriched
}

func TestLoadExistingStep_SlugNotFound(t *testing.T) {
    // Test error handling
    resource := &pb.Agent{
        Metadata: &apiresource.ApiResourceMetadata{
            Id: "",
            Slug: "nonexistent",
        },
    }
    
    err := step.Execute(ctx)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "not found")
    assert.Contains(t, err.Error(), "nonexistent")  // Error includes slug
}

func TestLoadExistingStep_NoIdentifier(t *testing.T) {
    // Test validation
    resource := &pb.Agent{
        Metadata: &apiresource.ApiResourceMetadata{
            Id: "",    // No ID
            Slug: "",  // No slug
        },
    }
    
    err := step.Execute(ctx)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "id or slug is required")
}
```

## Common Pitfalls

### ❌ Pitfall 1: Not Enriching Input

```go
// BAD: Find by slug but don't populate ID
if metadata.Slug != "" {
    existing := findBySlug(slug)
    ctx.Set(ExistingResourceKey, existing)
    return nil  // ❌ Input still missing ID!
}

// Downstream step tries to use ID → nil pointer panic!
```

**Fix**: Always enrich input with primary identifier:
```go
// GOOD: Populate ID so downstream steps have it
if metadata.Slug != "" {
    existing := findBySlug(slug)
    metadata.Id = existing.GetMetadata().Id  // ✅ Enrich input
    ctx.Set(ExistingResourceKey, existing)
    return nil
}
```

### ❌ Pitfall 2: Swapping Fast and Slow Paths

```go
// BAD: Check slug first (always O(n) even when ID available)
if metadata.Slug != "" {
    return findBySlug(slug)  // Slow path first!
} else if metadata.Id != "" {
    return findById(id)
}
```

**Fix**: Always check fast path first:
```go
// GOOD: Fast path first
if metadata.Id != "" {
    return findById(id)  // ✅ O(1) when ID present
} else if metadata.Slug != "" {
    return findBySlug(slug)  // O(n) only when needed
}
```

### ❌ Pitfall 3: No Error Differentiation

```go
// BAD: Generic error doesn't tell user what was searched
if found == nil {
    return errors.New("not found")  // Was it ID or slug that wasn't found?
}
```

**Fix**: Include identifier in error:
```go
// GOOD: Clear error with context
if found == nil {
    if searchedBy == "id" {
        return grpclib.NotFoundError("Agent", metadata.Id)
    } else {
        return grpclib.NotFoundError("Agent", metadata.Slug)
    }
}
```

### ❌ Pitfall 4: Premature Index Optimization

```go
// BAD: Adding complex index before proving need
type Store struct {
    resources map[string][]byte
    slugIndex map[string]string  // slug → id
    nameIndex map[string]string  // name → id
    // ... 5 more indexes
}
```

**Fix**: Start simple, add indexes when measured:
```go
// GOOD: Start with list scan (MVP)
func findBySlug(slug string) T {
    resources := store.ListResources()
    for _, r := range resources {
        if r.Slug == slug {
            return r
        }
    }
    return nil
}

// Add index later if profiling shows bottleneck
```

## Apply to Other Steps

This pattern can be used in other pipeline steps:

### LoadForApplyStep
Already uses this pattern! Finds by slug for existence check.

### LoadByReferenceStep (if exists)
Could support both reference ID and name:
```go
if ref.Id != "" {
    return findById(ref.Id)
} else if ref.Name != "" {
    return findByName(ref.Name)
}
```

### DeleteStep
Could support deletion by slug or ID:
```go
if input.Id != "" {
    return deleteById(id)
} else if input.Slug != "" {
    resource := findBySlug(slug)
    return deleteById(resource.Id)
}
```

## Summary

**Key Learnings:**

1. **Fallback Pattern**: Support multiple identifiers with primary (fast) + secondary (fallback) lookups
2. **Performance Trade-offs**: O(n) acceptable for local datasets (10-100 items) and infrequent operations
3. **State Enrichment**: When using fallback, enrich input with primary identifier for downstream steps
4. **Pipeline Resilience**: Make receiving pipelines resilient to missing enriched state from delegation
5. **MVP First**: Don't add indexes prematurely - measure before optimizing

**When to Use This Pattern:**

✅ Multiple ways to reference a resource (ID, slug, name, email)  
✅ Some callers may not have primary identifier  
✅ Performance acceptable for fallback path  
✅ Want to support flexible input without breaking existing fast paths  

**Files Modified:**
- `backend/libs/go/grpc/request/pipeline/steps/load_existing.go`
- Added `findBySlug()` method
- Modified `Execute()` to support ID or slug
- Added imports: `context`, `apiresourcekind`

**Related Commits:**
- `0fd7250` - Added slug fallback to LoadExistingStep
- `20260120-113743` - Changelog documenting the fix

---

**Next Steps for Future Work:**

If slug lookups become a bottleneck:
1. Add performance monitoring (log slow queries)
2. Profile actual usage patterns
3. Consider secondary index if needed
4. Implement composite keys or embedded indexes

For now: MVP approach is sufficient for Stigmer OSS local development use case.
