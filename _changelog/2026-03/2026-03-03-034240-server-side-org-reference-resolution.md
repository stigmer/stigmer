# Server-Side Org Reference Resolution (T01.4)

**Date**: March 3, 2026

## Summary

Added a generic pipeline step to both OSS (Go) and Cloud (Java) servers that automatically resolves empty `org` fields in `ApiResourceReference` messages at write time. This completes the server-side half of making cross-references portable — users can now omit `org` from references, and the server fills it from the parent resource's `metadata.org` before persisting.

## Problem Statement

With T01.3 making `org` optional in `ApiResourceReference`, clients can submit resources containing cross-references without specifying `org`. Without server-side resolution, these empty `org` values would be stored as-is, creating ambiguous references that downstream systems (reconciliation, agent execution, CLI display) cannot reliably resolve.

### Pain Points

- Empty `org` in stored references is ambiguous — does it mean "same org" or "unresolved"?
- Every consumer of cross-references would need its own resolution logic
- References would behave differently depending on whether the user happened to include `org`
- No single source of truth for what org a relative reference belongs to

## Solution

A single generic pipeline step, inserted into every Create and Update pipeline in both Go and Java servers, normalizes all `ApiResourceReference` messages within the resource's `spec` field. It uses Protobuf reflection to walk the spec recursively, finds every `ApiResourceReference`, and fills empty `org` with the resource's own `metadata.org`. This ensures all stored references are absolute and unambiguous.

## Implementation Details

### Architecture

- **Placement**: After `BuildNewState`/`BuildUpdateState` (when `metadata.org` is finalized), before `Persist`
- **Scope**: Only walks `spec` fields — `status` is system-generated and already absolute
- **Genericity**: Uses Protobuf descriptor reflection, not per-type code — automatically handles any resource with `ApiResourceReference` in its schema

### Go (OSS) — `NormalizeReferencesStep[T proto.Message]`

- `backend/libs/go/grpc/request/pipeline/steps/normalize_references.go`
- Uses `protoreflect.Message.Mutable()` for in-place mutation
- Handles singular, repeated, and map fields recursively
- 14 unit tests in `normalize_references_test.go`
- Wired into 16 controller pipelines (10 resource types)

### Java (Cloud) — `NormalizeApiResourceReferencesStepV2<R extends Message>`

- `backend/libs/java/grpc/grpc-request/.../NormalizeApiResourceReferencesStepV2.java`
- Uses `Message.toBuilder()` for immutable proto mutation pattern
- Added to `RequestOperationCommonSteps` as `normalizeReferences` field
- 12 unit tests in `NormalizeApiResourceReferencesStepV2Test.java`
- Wired into 29 handler pipelines (15 resource types)

### Key Design Decisions

- **All pipelines, not just reference-bearing ones**: Added to every Create/Update pipeline as a safe no-op, ensuring forward-compatibility as schemas evolve
- **Pipeline step over gRPC interceptor**: Interceptors fire before state building — metadata.org is not yet resolved at that point
- **Descriptor-based matching**: Uses `ai.stigmer.commons.apiresource.ApiResourceReference` full name for reliable type identification

## Benefits

- All stored cross-references are guaranteed absolute (have explicit org)
- Users can write portable YAML without specifying org in every reference
- Zero per-resource-type boilerplate — fully generic via reflection
- Forward-compatible — new resources with references are automatically covered
- Consistent behavior across OSS and Cloud deployments

## Impact

- **Server pipeline**: Every resource Create/Update now passes through reference normalization
- **Storage**: All persisted `ApiResourceReference` messages will have explicit `org` values
- **Downstream consumers**: Can rely on `org` being populated — no need for resolution logic
- **Users**: Can omit `org` from cross-references in YAML/API calls — portable by default

## Related Work

- T01.3: Made `org` optional in `ApiResourceReference` proto (prerequisite)
- T01.5: Organization OSS controllers (provides the Organization resource that owns `metadata.org`)
- T01.6: Seedpack updates (next — will remove `org: local` from reference YAML, relying on this resolution)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
