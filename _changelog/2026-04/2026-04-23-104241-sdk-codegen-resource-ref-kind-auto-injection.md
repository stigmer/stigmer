# SDK Codegen: Auto-Inject `kind` in Resource References

**Date**: April 23, 2026

## Summary

All four SDK codegens (Go, Java, Python, TypeScript) now automatically set the `kind` field on `ApiResourceReference` messages when the proto field carries a `reference_kind` annotation. This eliminates a class of validation errors where the server rejected requests due to missing `kind` values, and removes the burden from SDK consumers to know and set the correct resource kind for every reference field.

A secondary change moves the BSR (Buf Schema Registry) publish step from the local `make release` command into a dedicated GitHub Actions workflow, aligning it with the existing CI-driven release pattern.

## Problem Statement

PR #130 from a customer added a `kind` field to the Java SDK's `ResourceRef` class because the server's CEL validation was rejecting requests with empty `kind`. Investigation revealed the root cause was not in the Java SDK's `ResourceRef` type, but in the codegen pipeline: none of the four SDK codegens were reading the `reference_kind` proto field option to auto-populate `kind` during serialization.

### Pain Points

- Customers had to manually set `kind` on every `ResourceRef` — error-prone and undiscoverable
- The MCP codegen already handled `reference_kind` correctly; the SDK codegens did not
- `environment_refs` fields on `AgentInstanceSpec` and `WorkflowInstanceSpec` were missing the `reference_kind` annotation entirely
- The `apiResourceKindEnumNames` and `versionedKinds` maps in `mcp.go` were hardcoded, requiring manual updates whenever a new `ApiResourceKind` was added
- The BSR publish (`buf push`) was part of the local `make release` command, requiring local Buf authentication and coupling proto publishing with tag creation

## Solution

### SDK Codegen Kind Auto-Injection

For every `ApiResourceReference` field that carries `(reference_kind) = <kind>`, the codegen now emits code that sets `kind` to the annotated value during `toProto()` / serialization. This covers both singular and repeated reference fields.

For "multi-kind" fields (no `reference_kind` annotation), the Java `ResourceRef` was enhanced with explicit `kind` factory methods so users can set it when needed.

### Proto Reflection for Kind Maps

Replaced the hardcoded `apiResourceKindEnumNames` and `versionedKinds` maps with runtime derivation from the Go proto stubs using protobuf descriptor reflection. A new `resource_kind.go` imports the generated `ApiResourceKind` enum, iterates its values and `kind_meta` extensions at `init()` time, and populates both maps — zero maintenance when new resource kinds are added.

### Missing `reference_kind` Annotations

Added `(reference_kind) = environment` to `environment_refs` on both `AgentInstanceSpec` and `WorkflowInstanceSpec`, plus the required `field_options.proto` import.

### BSR Push to CI

Created `.github/workflows/release.buf.yaml` triggered on `v*` tags. Removed `$(MAKE) -C apis release` from the root Makefile's `release` target.

## Implementation Details

### Codegen Changes (4 SDKs)

- **Go** (`sdk_client.go`): Detects `ReferenceKind != 0`, forces imperative mode for the nested type, and emits `Kind: apiresourcekind.ApiResourceKind_<name>` on the constructed proto message.
- **Java** (`sdk_client_java.go`): Emits `.toProto().toBuilder().setKind(ApiResourceKind.<name>).build()` for annotated fields. Updated `ResourceRef` with `kind` field and typed factory methods.
- **Python** (`sdk_client_python.go`): Emits `_ref.kind = <int>` after constructing the `ApiResourceReference` message.
- **TypeScript** (`sdk_client_ts.go`): Emits spread syntax `{ ...ref, kind: <int> }` to overlay the kind value.

### New File: `resource_kind.go`

Uses `protoreflect` to walk the `ApiResourceKind` enum descriptor, building `apiResourceKindEnumNames` (num→name) and `versionedKinds` (num→bool) maps. Replaces 30+ lines of hand-maintained constants.

### Proto Annotations

```protobuf
// agentinstance/v1/spec.proto & workflowinstance/v1/spec.proto
repeated ApiResourceReference environment_refs = N [
    (ai.stigmer.commons.apiresource.reference_kind) = environment
];
```

### CI Workflow: `release.buf.yaml`

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
```

Runs `buf lint` as a quality gate, then `buf push` with `BUF_TOKEN` from GitHub secrets.

## Benefits

- **Zero-effort kind correctness**: SDK users never need to think about `kind` for single-kind reference fields
- **Multi-kind flexibility**: Java `ResourceRef.of(org, kind, slug)` factory for fields without `reference_kind`
- **Maintenance-free kind maps**: Adding a new `ApiResourceKind` to the proto enum automatically flows to all codegens — no manual map updates
- **CI-driven BSR publish**: BSR push happens automatically on tag push, consistent with all other release artifacts
- **BUF_TOKEN secret**: Now set in the repo, fixing the pre-existing gap in `release.cli.yaml`

## Impact

- **SDK consumers**: Requests with `ApiResourceReference` fields no longer fail server-side CEL validation for missing `kind`
- **Platform maintainers**: No manual map maintenance when resource kinds change; BSR publishing is fully automated
- **All SDKs**: Go, Java, Python, TypeScript all behave consistently
- **Release pipeline**: `make release` is now a pure tag-and-push operation; all artifact publishing is in CI

## Related Work

- [PR #130](https://github.com/stigmer/stigmer/pull/130) — customer-submitted Java SDK fix (identified the symptom)
- `reference_kind` field option (proto extension 90204) — the mechanism that enables kind derivation
- `kind_meta.is_versioned` extension — drives the `versionedKinds` map

---

**Status**: ✅ Production Ready
**Timeline**: Single session
