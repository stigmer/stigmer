# Checkpoint: Document OSS vs Cloud Pipeline Differences

**Date**: 2026-01-18  
**Type**: Documentation Improvement  
**Phase**: 9.1 - Architecture Documentation

---

## Summary

Clarified and documented the architectural differences between Stigmer Cloud and Stigmer OSS request pipelines, removing ambiguity about which pipeline steps should be implemented in OSS and establishing clear guidance for all future controllers.

---

## What Changed

### 1. Agent Create Handler Documentation

**File**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`

**Before**:
- Pipeline documentation listed 12 steps (mirroring Cloud)
- TODOs suggested features would be implemented "when auth ready", "when IAM ready", etc.
- Step numbering was confusing (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 → but many skipped)
- Unclear which steps would actually be in OSS

**After**:
- Pipeline documentation shows 7 actual steps
- Removed all TODOs for steps that won't be implemented
- Added explicit note comparing to Cloud and explaining exclusions
- Sequential numbering (1-7)
- Clear architectural statement about OSS scope

**Impact**:
- ✅ Developers immediately understand OSS pipeline boundaries
- ✅ No confusion about "missing" features (they're intentionally excluded)
- ✅ Self-documenting code with architectural context

### 2. Implementation Rule Enhancement

**File**: `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc`

**Added new section**: "Pipeline Steps: Cloud vs OSS"
- Detailed comparison table of excluded steps with rationale
- Table of included steps with implementation notes
- Side-by-side pipeline comparison (12 steps vs 7 steps)
- Clear architectural guidance for all future controllers

**Impact**:
- ✅ Single source of truth for OSS pipeline architecture
- ✅ Future controllers (Workflow, Task, etc.) have clear template
- ✅ New contributors understand scope immediately
- ✅ No need to reference Cloud code for architectural decisions

---

## Why This Matters

### Prevents Future Confusion

**Without this documentation**:
- Developers wonder when authorization will be added (answer: never in OSS)
- TODOs create false expectation of "coming soon" features
- Unclear which patterns to follow when implementing new controllers
- Comparison with Cloud creates uncertainty about feature parity

**With this documentation**:
- ✅ Clear boundaries: Cloud = enterprise, OSS = local/single-user
- ✅ Explicit rationale for each exclusion
- ✅ No ambiguity about implementation scope
- ✅ Confident implementation of future controllers

### Establishes OSS Architectural Identity

**Cloud (12 steps)**: Enterprise multi-tenant, authorization, IAM, events, transformations

**OSS (7 steps)**: Local single-user, core lifecycle only

**Excluded from OSS** (with clear rationale):
| Step | Rationale |
|------|-----------|
| Authorize | Local/single-user - no multi-tenant auth needed |
| CreateIamPolicies | No OpenFGA or IAM system in OSS |
| Publish | No event bus infrastructure |
| TransformResponse | Return full resources - no filtering needed |

### Template for All Future Controllers

When implementing Workflow, Task, or any other controller:

**OSS Pipeline Template**:
1. ValidateFieldConstraints
2. ResolveSlug
3. CheckDuplicate
4. BuildNewState
5. Persist
6. Custom business logic steps (if needed)

**Don't implement**: Authorize, CreateIamPolicies, Publish, TransformResponse

---

## Technical Implementation

### Agent Create Handler Changes

**Pipeline documentation**:
```go
// Create creates a new agent using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists
// 4. BuildNewState - Generate ID, timestamps, audit fields
// 5. Persist - Save agent to repository
// 6. CreateDefaultInstance - Create default agent instance
// 7. UpdateAgentStatusWithDefaultInstance - Update agent status
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
```

**Before**: 12 steps with TODOs  
**After**: 7 steps with clear exclusion note

### Implementation Rule Changes

**New section added**: "Pipeline Steps: Cloud vs OSS"

**Content**:
1. Table of excluded steps with rationale
2. Table of included steps
3. Side-by-side comparison example (Agent Create pipeline)
4. Architectural philosophy statement

**Lines added**: ~60 lines of structured documentation

---

## Architecture Philosophy

### Cloud (Java)
- Enterprise-ready, multi-tenant SaaS
- Fine-grained access control (OpenFGA)
- Event-driven architecture (domain events)
- Response filtering and transformations
- Complex authorization rules
- Audit trails and compliance

### OSS (Go)
- Developer-friendly, local development
- Simple deployment, minimal infrastructure
- No external dependencies (BadgerDB embedded)
- Full resource responses
- No authorization (single-user assumption)
- Focus on core resource lifecycle

**Both share**: Proto validation, slug resolution, duplicate checking, audit fields, persistence

---

## Documentation Structure

### Files Modified

```
backend/services/stigmer-server/pkg/controllers/agent/create.go
  +39 lines documentation improvements
  -12 steps → +7 steps (clear count)
  -TODOs for excluded steps
  +Architectural comparison note

backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc
  +~60 lines new section
  +3 comparison tables
  +Side-by-side pipeline example
  +Architectural philosophy
```

### Documentation Quality

**Follows documentation standards**:
- ✅ Grounded in truth (real architecture, not speculation)
- ✅ Clear comparisons with context
- ✅ Structured with tables and examples
- ✅ Explains "why" not just "what"
- ✅ Actionable guidance for developers

---

## Impact Assessment

### Immediate Benefits

**Clarity**:
- Developers know exactly which steps to implement
- No confusion about "missing" features
- Clear template for future controllers

**Confidence**:
- New contributors understand OSS scope
- No second-guessing architectural decisions
- No time wasted on unnecessary features

**Consistency**:
- All future controllers will follow same pattern
- Rule file ensures uniform implementation
- No divergence from established architecture

### Long-Term Benefits

**Maintainability**:
- Self-documenting code with architectural context
- Easy to onboard new contributors
- Clear separation of Cloud vs OSS concerns

**Evolution**:
- If OSS adds features, explicit documentation of decisions
- Easy to compare against Cloud for feature parity discussions
- Foundation for architectural decision records

---

## Developer Experience Impact

### Before This Change

**Developer thinking**:
- "When will authorization be added?"
- "Should I implement IAM policies?"
- "Is event publishing coming soon?"
- "Am I missing something?"

**Developer behavior**:
- Reading Cloud code for reference
- Uncertain about implementation scope
- Asking questions about missing features
- Implementing unnecessary complexity

### After This Change

**Developer thinking**:
- "OSS has 7 steps, Cloud has 12 - I know which to implement"
- "Authorization is excluded by design - not on my plate"
- "I can focus on core lifecycle management"

**Developer behavior**:
- ✅ Confident implementation from rule documentation
- ✅ No confusion about scope
- ✅ Focus on what matters for OSS
- ✅ Fast implementation of new controllers

---

## Testing and Validation

### Documentation Accuracy

**Verified**:
- ✅ Agent create handler actually has 7 steps
- ✅ Step names and descriptions match code
- ✅ Cloud comparison is accurate (checked Java code)
- ✅ Rationale for exclusions is architecturally sound

### Build Verification

```bash
cd backend/services/stigmer-server
go build ./...
```

**Result**: ✅ All code compiles successfully

---

## Future Work

### Immediate

1. Apply same documentation pattern to other handlers:
   - Agent Update handler
   - Agent Delete handler
   - AgentInstance Create handler

2. Use rule as reference for new controllers:
   - Workflow controller
   - Task controller
   - Any other API resources

### Long-Term

1. If OSS architecture evolves, update both:
   - Handler documentation
   - Rule file comparison section

2. Consider creating ADR if major decisions change

---

## Related Documentation

**Created in this session**:
- `_changelog/2026-01/2026-01-18-211338-document-oss-pipeline-differences.md`

**Updated**:
- `backend/services/stigmer-server/pkg/controllers/agent/create.go`
- `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc`

**Reference**:
- Cloud implementation: `stigmer-cloud/backend/services/stigmer-service/.../AgentCreateHandler.java`
- OSS pipeline framework: `backend/libs/go/grpc/request/pipeline/`

---

## Lessons Learned

### Documentation Best Practices

1. **Be Explicit About Non-Goals**
   - Don't just document what you will do
   - Explicitly state what you won't do and why
   - Prevents future confusion and wasted effort

2. **Provide Context**
   - Comparing OSS to Cloud helps developers understand scope
   - Rationale is as important as implementation details
   - Architecture philosophy guides decisions

3. **Make It Actionable**
   - Template pattern for future controllers
   - Clear checklist of what to include/exclude
   - No room for interpretation

### Rule Improvement

**This checkpoint itself follows the rule improvement pattern**:
- Learning detected: Need to document OSS vs Cloud differences
- Rule updated: Added detailed comparison section
- High-signal improvement: Prevents future confusion for all controllers

---

## Completion Checklist

- [x] Handler documentation updated with accurate step count
- [x] TODOs removed for excluded steps
- [x] Architectural comparison note added
- [x] Rule file enhanced with comparison section
- [x] Tables created for included/excluded steps
- [x] Side-by-side pipeline example added
- [x] Rationale provided for each exclusion
- [x] Build verified successfully
- [x] Changelog created
- [x] Checkpoint created

---

## Next Steps

1. **Test Documentation**
   - Verify developers can follow the rule to implement new controllers
   - Check if any questions remain unanswered

2. **Apply Pattern to Other Handlers**
   - Update Update/Delete handlers with same clarity
   - Ensure consistency across all CRUD operations

3. **Integration Testing**
   - Continue with Phase 10: Integration testing (from next-task.md)
   - Verify agent creation flow end-to-end

---

**Status**: ✅ Complete  
**Build**: ✅ Passing  
**Documentation**: ✅ Comprehensive  
**Ready for**: Commit and continue with integration testing
