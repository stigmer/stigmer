# Learning: Pipeline Step Ordering - ResolveSlug Before Validate

**Date**: 2026-01-20  
**Category**: Critical Bug Fix / Pattern Correction  
**Impact**: All Controllers

## Discovery

The rule documentation showed incorrect pipeline step ordering for Create and Update operations, which was propagated to all 19 controllers (10 create + 9 update).

## The Bug

**Incorrect order** (from original rule documentation):
```
Create:  Validate → ResolveSlug → CheckDuplicate → SetDefaults → Persist
Update:  Validate → LoadExisting → Merge → Persist
```

**Problem**: Validation ran before slug resolution, causing this error when users didn't provide explicit slug values:
```
validation error: slug: value length must be at least 1 characters
```

## Root Cause

1. Proto field constraints require slug to be non-empty: `[(buf.validate.field).string.min_len = 1]`
2. Users provide only `name` field, expecting auto-slug generation
3. ValidateProto runs first, sees empty slug field, validation fails
4. ResolveSlug never gets a chance to populate the slug

## Correct Pattern

**Fixed order** (now documented in rule):
```
Create:  ResolveSlug → Validate → CheckDuplicate → BuildNewState → Persist
Update:  ResolveSlug → Validate → LoadExisting → BuildUpdateState → Persist
```

**Why this works**:
1. ResolveSlug populates slug from name FIRST
2. Validation sees populated slug and passes
3. Rest of pipeline proceeds normally

## Implementation Example

### Create Pipeline (Correct)

```go
func (c *AgentController) buildCreatePipeline() *pipeline.Pipeline[*agentv1.Agent] {
    return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).           // 1. Resolve slug FIRST
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).         // 2. THEN validate
        AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store)). // 3. Check duplicate
        AddStep(steps.NewBuildNewStateStep[*agentv1.Agent]()).         // 4. Build state
        AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).        // 5. Persist
        Build()
}
```

### Update Pipeline (Correct)

```go
func (c *AgentController) buildUpdatePipeline() *pipeline.Pipeline[*agentv1.Agent] {
    return pipeline.NewPipeline[*agentv1.Agent]("agent-update").
        AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).        // 1. Resolve slug FIRST
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).      // 2. THEN validate
        AddStep(steps.NewLoadExistingStep[*agentv1.Agent](c.store)). // 3. Load existing
        AddStep(steps.NewBuildUpdateStateStep[*agentv1.Agent]()).   // 4. Build updated state
        AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).     // 5. Persist
        Build()
}
```

## Additional Update Fixes

Some update controllers were missing critical steps:

**Missing ResolveSlug** (added to):
- `workflow/controller/update.go`
- `workflowinstance/controller/update.go`

**Missing BuildUpdateStateStep** (added to):
- `workflow/controller/update.go` (was jumping from LoadExisting → Persist)
- `workflowinstance/controller/update.go` (was jumping from LoadExisting → Persist)

**What BuildUpdateStateStep does**:
- Merges spec from input with existing state
- Preserves status (doesn't clear/change it)
- Preserves metadata IDs (id, slug, org, owner_scope)
- Updates audit fields (modified_at timestamp, modified_by)
- Clears computed fields that need recalculation

This step is critical for proper update semantics - without it, you either overwrite the entire resource (losing status) or don't properly merge changes.

## Impact

**Before fix**:
- ❌ All create operations failed when users didn't provide slug
- ❌ Some update operations missing slug resolution
- ❌ Some update operations missing state merging logic
- ❌ Rule documentation led developers to implement incorrect patterns

**After fix**:
- ✅ Create operations work with name-only resources
- ✅ Update operations properly resolve slug from name
- ✅ Update operations properly merge state (preserve status, update audit fields)
- ✅ Rule documentation shows correct pattern
- ✅ Consistent with Java Cloud implementation

## Files Changed

**Controllers fixed** (19 files):
- All create controllers (10): agent, workflow, skill, environment, agentinstance, workflowinstance, session, executioncontext, agentexecution, workflowexecution
- All update controllers (9): agent, workflow, skill, environment, agentinstance, workflowinstance, session, agentexecution, workflowexecution

**Rule documentation fixed** (1 file):
- `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc`

## Key Takeaway

**ResolveSlug MUST come before ValidateProto** for any operation that:
1. Accepts a `name` field from users
2. Auto-generates `slug` from name
3. Has proto validation constraints on slug field

This applies to Create, Update, and Apply operations. Delete and Get don't need slug resolution (they use ID).

## Prevention

**Rule documentation updated** with:
1. Corrected pipeline step order in table
2. Critical warning section explaining WHY this order is mandatory
3. Examples showing correct and incorrect patterns
4. Historical context about the bug

Future handler implementations will follow the corrected pattern from the rule, preventing this bug from being reintroduced.
