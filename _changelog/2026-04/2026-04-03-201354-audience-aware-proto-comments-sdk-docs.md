# Audience-Aware Proto Comments & Internal-Leak-Free SDK Docs

**Date**: April 3, 2026

## Summary

Introduced the `@internal` marker convention for proto comments and updated the SDK docs generator to produce audience-aware documentation. All 32 resource proto files were audited and updated to separate SDK-facing descriptions from internal implementation details. The generated SDK reference pages now contain zero leakage of internal terminology (Temporal, FGA, OpenFGA, etc.), giving SDK users clean, focused documentation.

## Problem Statement

The auto-generated SDK reference documentation was leaking internal implementation details that confused SDK users and exposed platform internals.

### Pain Points

- Proto comments contained internal-only terminology visible to SDK users (e.g., "Custom authorization in handler", "Temporal's CancelWorkflow API", "FGA tuples")
- No convention existed to separate content intended for internal developers from content intended for SDK users
- The old `docMethodSummary()` function truncated descriptions at the first paragraph break, losing useful multi-paragraph SDK content
- Many proto descriptions were thin or vague (e.g., "lookup api-key") and needed enrichment for SDK users
- Authorization implementation details (OpenFGA tuples, FGA relations, handler-level auth) appeared in user-facing docs

## Solution

A two-part approach: (1) establish the `@internal` proto comment convention to annotate audience boundaries at the source, and (2) update the Go generator to strip internal content during MDX production.

### The `@internal` Convention

Proto comments now use `// @internal` on its own line to separate audiences:

```protobuf
// Cancel a running agent execution gracefully.
//
// Sends a cancellation signal to the agent execution. The agent can handle
// the cancellation signal to save checkpoint and clean up before
// transitioning to the CANCELLED phase.
//
// @internal
// Temporal Equivalent: `temporal workflow cancel --workflow-id <id>`
//
// ## Behavior
// 1. Validates execution exists and is in a cancellable phase
// 2. Sends cancellation signal to Temporal workflow
// ...
```

Everything above `@internal` appears in SDK docs. Everything below is only visible to developers reading the proto source.

## Implementation Details

### Generator Changes (`tools/codegen/generator/sdk_docs.go`)

**New functions:**
- `docStripInternal(desc)` -- scans lines for `@internal` and drops everything from that point onward
- `docSDKContent(desc)` -- replaces `docMethodSummary()`: extracts full multi-paragraph SDK content after stripping `@internal` and `@since` markers, preserving paragraph structure

**Updated call sites:**
- `docWriteMethod()` -- uses `docSDKContent()` for method detail sections
- `docWriteMethodOverview()` -- applies `docStripInternal()` before `docFirstSentence()` for table summaries
- `docWriteTypeField()` and `docWriteNestedType()` -- strip internal from field/type descriptions
- `docOverviewSummary()` -- strip internal from spec overview text

**Removed:**
- `docMethodSummary()` -- replaced by `docSDKContent()` which doesn't truncate at paragraph boundaries

### Proto Comment Audit (32 files)

Updated proto files across all three domains:

| Domain | Files | Key Changes |
|--------|-------|-------------|
| Agentic | 20 | Moved Temporal API refs (CancelWorkflow, TerminateWorkflow, ResetWorkflow, SignalWithStart) after `@internal`; enriched lifecycle RPC descriptions; renamed "Temporal task token" to "Callback token" |
| IAM | 8 | Moved FGA/OpenFGA references after `@internal`; enriched "lookup" descriptions; added `@internal` to spec field descriptions (key_hash, relation, ApiResourceRef.relation) |
| Platform | 4 | Added `@internal` for handler-level auth details; enriched organization/project query descriptions |

### Eliminated Internal Terminology

Before and after examples:

| Before | After |
|--------|-------|
| `lookup api-key.` | `Get an API key by its unique identifier.` |
| `Custom authorization in handler.` | `Get an agent by its organization-scoped reference (org/slug).` |
| `Sends a cancellation signal via Temporal's CancelWorkflow API.` | `Sends a cancellation signal to the agent execution.` |
| `All FGA tuples use identity_account as the principal type.` | `An identity account represents a user or machine principal in Stigmer.` |
| `Authorization handled in handler via IAM Policy listAuthorizedResourceIds` | `Find organizations the authenticated user is a member of.` |

## Benefits

- **Clean SDK docs**: Zero occurrences of Temporal, FGA, OpenFGA, inProcessChannel, or other internal terminology in generated MDX
- **Richer content**: Full multi-paragraph descriptions instead of first-paragraph truncation
- **Source-level convention**: `@internal` is grep-able, requires no tooling changes, and is self-documenting in proto files
- **Maintainable**: Future proto authors just add `// @internal` above internal notes -- the pipeline handles the rest
- **74 files changed**: 32 proto files, 7 spec schemas, 17 service schemas, 17 MDX pages, 1 generator file

## Impact

- **SDK users**: See clean, focused documentation without internal implementation details
- **Internal developers**: Retain full technical context in proto source files
- **Documentation pipeline**: Automatically filters audience-appropriate content at generation time
- **All 17 SDK reference pages**: Regenerated with audience-aware content

## Related Work

- [SDK Docs Auto-Generation PoC](2026-04-03-185754-sdk-docs-auto-generation-poc.md)
- [SDK Docs Template Refinement](2026-04-03-192442-sdk-docs-template-refinement.md)
- [SDK Docs Generator Edge-Case Hardening](2026-04-03-194722-sdk-docs-generator-edge-case-hardening.md)

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 of the sdk-docs-auto-generation project
