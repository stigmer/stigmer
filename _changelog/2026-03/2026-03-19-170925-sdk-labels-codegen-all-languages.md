# SDK Labels Codegen Fix — All 4 Languages

**Date**: March 19, 2026

## Summary

Added an optional `labels` field to all 17 SDK resource input types across Go, TypeScript, Java, and Python by modifying the 4 codegen generators and regenerating all SDK clients. This unblocks Phase 2 personal environment creation, which needs to set `labels: { "stigmer.ai/personal": "true" }` at creation time.

## Problem Statement

`ApiResourceMetadata.labels` (`map<string, string>`) has existed in the proto definition since the beginning, but none of the SDK codegen generators emitted `labels` in their resource input types or wired it into metadata construction. Every SDK input type (e.g., `EnvironmentInput`, `AgentInstanceInput`) only exposed `name` and `org` as metadata fields.

### Pain Points

- The `usePersonalEnvironment.getOrCreate()` hook could not set labels at creation time, blocking personal environment identification via label-based queries
- No SDK in any language could set labels on resource creation, despite the proto and backend fully supporting them
- The gap existed identically in all 4 codegen generators (Go, TypeScript, Java, Python)

## Solution

Fixed the 4 codegen generators (the source of truth) rather than manually editing 68 individual generated files. Each generator received two changes: (1) add `labels` to the input type definition, and (2) wire `labels` into the `ApiResourceMetadata` construction in the build-proto function.

## Implementation Details

### Generator changes (4 files)

| Generator | Input Type | Metadata Wiring |
|-----------|-----------|-----------------|
| Go (`sdk_client.go`) | `Labels map[string]string` | `Labels: i.Labels` (nil is zero-value safe) |
| TypeScript (`sdk_client_ts.go`) | `labels?: Record<string, string>` | `...(input.labels && { labels: input.labels })` (conditional spread) |
| Java (`sdk_client_java.go`) | `java.util.Map<String, String> labels` + builder | `if (this.labels != null) metaBuilder.putAllLabels(this.labels)` |
| Python (`sdk_client_python.go`) | `labels: dict[str, str] \| None = None` | `if self.labels: metadata.labels.update(self.labels)` |

### Defensive addition

Added `"Labels": true` to the `metaFieldNames` set in `sdk_client.go`, preventing any future spec schema that defines a `Labels` field from conflicting with the metadata labels field. This follows the existing pattern for `Tags` and `Visibility`.

### Regenerated output (68 files)

All 17 resource types regenerated across Go, TypeScript, Java, and Python. Each resource input type now includes `labels` with appropriate language-idiomatic defaults (nil/undefined/None/null) that preserve backward compatibility.

### Design decisions

- **Labels only**: Did not add `tags` or `visibility` to SDK inputs despite the same gap. These have different semantics (repeated string, enum) and may warrant different input ergonomics. Adding them later follows the same pattern.
- **Conditional wiring**: Each language guards against setting labels when not provided, preserving identical behavior for existing callers.
- **Java restructuring**: Restructured `toProto()` to use a separate `metaBuilder` variable (like the existing `spec` builder pattern) to support conditional `putAllLabels`.
- **Python restructuring**: Restructured `_to_proto()` to build metadata separately to allow `ScalarMapContainer.update()` for map fields.

## Benefits

- All SDK languages can now set labels on any resource at creation/update time
- Personal environment identification via `labels: { "stigmer.ai/personal": "true" }` is unblocked for Phase 2
- React hooks (`useCreateEnvironment`, `useUpdateEnvironment`) automatically accept labels via TypeScript structural typing — zero React changes needed
- Consistent behavior across all 4 SDKs
- Zero behavioral change for existing callers (labels defaults to not-set)

## Impact

- **SDK consumers**: All 4 SDK packages (Go, TypeScript, Java, Python) gain a new optional field on every resource input type
- **React SDK**: Existing hooks pass through the typed input automatically — no code changes
- **Backends**: No changes needed — backends already accept and persist labels from `ApiResourceMetadata`
- **Phase 2**: Unblocks `usePersonalEnvironment.getOrCreate()` label-based creation

## Related Work

- Part of sub-project `20260319.05.sp.sdk-labels-and-env-var-ops` (Track A)
- Parent project: `20260319.02.agent-picker-personal-env` (Phase 2 preparation)
- Depends on: `ApiResourceMetadata.labels` proto field (already existed)
- Enables: Personal environment identification, label-based list queries

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
