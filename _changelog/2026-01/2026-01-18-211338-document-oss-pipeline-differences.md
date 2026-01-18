# Document OSS vs Cloud Pipeline Differences

**Date**: 2026-01-18  
**Type**: Documentation Improvement  
**Scope**: Backend Controllers, Implementation Rules

---

## Summary

Clarified and documented the architectural differences between Stigmer Cloud and Stigmer OSS request pipelines. Updated both the Agent create handler and the implementation rule to clearly specify which pipeline steps are excluded in the OSS version and why.

---

## What Changed

### Agent Create Handler (`backend/services/stigmer-server/pkg/controllers/agent/create.go`)

**Before**: Pipeline documentation listed 12 steps with TODOs for excluded steps:
- TODOs for "Authorize (when auth ready)"
- TODOs for "CreateIamPolicies (when IAM ready)"
- TODOs for "Publish (when event system ready)"
- TODOs for "TransformResponse (if needed)"
- Unclear numbering (jumped from step 1 to step 3)

**After**: Pipeline documentation clearly shows 7 actual steps:
- Removed all TODOs for steps that won't be implemented in OSS
- Added explicit note documenting excluded steps and rationale
- Renumbered pipeline steps sequentially (1-7)
- Clear comparison to Cloud architecture

### Implementation Rule (`backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc`)

**Added new section**: "Pipeline Steps: Cloud vs OSS"
- Table of excluded steps with rationale
- Table of included steps with implementation notes
- Side-by-side comparison of Agent Create pipeline (Cloud vs OSS)
- Clear architectural guidance for all future controllers

---

## Why This Matters

### Prevents Confusion

Without this documentation:
- Developers might wonder when auth/IAM will be implemented (answer: never in OSS)
- TODOs suggest features are "coming soon" when they're architectural non-goals
- Unclear which patterns to follow when implementing new controllers

With this documentation:
- ✅ Clear architectural boundaries: Cloud = enterprise multi-tenant, OSS = local single-user
- ✅ No ambiguity about which steps to implement
- ✅ Explicit rationale for exclusions (not just "coming later")

### Establishes OSS Identity

**OSS is intentionally simplified**:
- No authorization (local single-user use case)
- No IAM/FGA (no need for fine-grained permissions)
- No event publishing (no distributed event system)
- No response transformations (return full resources)

**OSS focuses on**:
- ✅ Core resource lifecycle management
- ✅ Validation and duplicate checking
- ✅ Local persistence (BadgerDB/SQLite)
- ✅ Proto-based APIs

### Provides Implementation Guidance

For all future controllers (Workflow, Task, etc.), developers now know:

**OSS Pipeline Template**:
```
1. ValidateFieldConstraints
2. ResolveSlug
3. CheckDuplicate
4. BuildNewState
5. Persist
6. Custom business logic steps (if needed)
```

**Excluded from OSS** (don't implement):
- Authorize
- CreateIamPolicies
- Publish
- TransformResponse

---

## Technical Details

### Pipeline Step Count

| Version | Steps | Focus |
|---------|-------|-------|
| **Cloud** | 12 steps | Enterprise multi-tenant with auth, IAM, events |
| **OSS** | 7 steps | Local single-user with core lifecycle only |

### Excluded Steps Rationale

| Step | Why Excluded |
|------|-------------|
| **Authorize** | OSS is local/single-user - no multi-tenant authorization needed |
| **CreateIamPolicies** | OSS has no OpenFGA or IAM system |
| **Publish** | OSS has no event bus infrastructure |
| **TransformResponse** | OSS returns full resources - no filtering needed |

### Architecture Philosophy

**Cloud**: Enterprise-ready, multi-tenant, fine-grained access control, event-driven architecture

**OSS**: Developer-friendly, local development, simple deployment, minimal infrastructure dependencies

---

## Impact

### Documentation
- ✅ Agent create handler now has accurate pipeline documentation
- ✅ Implementation rule serves as source of truth for all controllers
- ✅ Clear comparison tables prevent architectural confusion
- ✅ Future controller implementations have clear guidance

### Code Quality
- ✅ Removed misleading TODOs that suggested features would be implemented
- ✅ Accurate step numbering (1-7 instead of 1,3,4,5,6,8,9...)
- ✅ Self-documenting code with explicit architectural notes

### Developer Experience
- ✅ New contributors understand OSS scope immediately
- ✅ No time wasted wondering when auth/IAM will be added
- ✅ Clear pattern to follow for new controllers

---

## Next Steps

### For Future Controllers

When implementing Workflow, Task, or other controllers:
1. ✅ Use the 7-step OSS pipeline template
2. ✅ Don't implement Authorize, CreateIamPolicies, Publish, or TransformResponse
3. ✅ Focus on validation, duplicate checking, and persistence
4. ✅ Add custom steps for domain-specific logic

### Documentation Maintenance

The rule file now serves as the canonical reference for:
- Which steps to include in OSS pipelines
- Rationale for architectural decisions
- Comparison with Cloud implementation
- Pattern consistency across all controllers

---

## Files Modified

```
backend/services/stigmer-server/pkg/controllers/agent/create.go
  - Updated pipeline documentation (12 steps → 7 steps)
  - Removed TODOs for excluded steps
  - Added architectural comparison note
  - Fixed step numbering

backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/implement-stigmer-oss-handlers.mdc
  - Added "Pipeline Steps: Cloud vs OSS" section
  - Created comparison tables
  - Added side-by-side pipeline examples
  - Documented rationale for each exclusion
```

---

## Conclusion

This documentation improvement establishes clear architectural boundaries between Stigmer Cloud and Stigmer OSS. The OSS version is intentionally simplified for local/single-user use cases, excluding enterprise features like authorization, IAM, event publishing, and response transformations.

All future controller implementations now have a clear template to follow, preventing confusion and ensuring consistency across the OSS codebase.
