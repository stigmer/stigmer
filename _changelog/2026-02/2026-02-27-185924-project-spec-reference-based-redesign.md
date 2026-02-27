# ProjectSpec Redesigned to Reference-Based Membership Model

**Date**: February 27, 2026

## Summary

Redesigned the Project proto API from a heavyweight container of full embedded resource objects to a lightweight reference-based membership tracker. This foundational change enables the upcoming declarative directory-scanning track and simplifies the reconciliation model from deep spec-diffing to set-difference orphan pruning.

## Problem Statement

The `ProjectSpec` message embedded full `Agent`, `Workflow`, `McpServer`, and `Skill` proto objects, making the Project an aggregate root that duplicated resource data. This created several issues:

### Pain Points

- Resources had two authoritative locations: their own table and the embedded copy in the Project spec
- The reconciliation engine required a full dependency graph with topological sorting to process embedded objects in the right order
- Adding a new declarative track (YAML files in a directory) would be awkward since the CLI would need to parse YAML resources into full proto objects just to embed them in the Project
- A separate `ProjectRuntime` enum was redundant with the `entry_point` file extension and introduced cross-field validation complexity
- A bespoke `ResourceChangeRecord` type duplicated what `ApiResourceReference` already provides

## Solution

Transformed `ProjectSpec` into a minimal 3-field message:

1. `entry_point` (optional) — when set, CLI infers SDK runtime from file extension; when absent, project is declarative
2. `description` (optional) — human-readable project description
3. `members` (`repeated ApiResourceReference`) — references to resources managed by this project, populated by the CLI after applying individual resources

In the new model, resources are always applied individually via their own RPCs first. The project only tracks membership references. Orphan pruning becomes a simple set-difference: `previous_members - current_members = orphans`.

## Implementation Details

### Proto Changes (4 files modified, 1 deleted)

- **`spec.proto`**: Removed 5 imports and 5 fields (runtime + 4 embedded resource types). Added `ApiResourceReference` import and `members` field. Renumbered fields to clean sequential 1/2/3.

- **`enum.proto`**: Deleted entirely. `ProjectRuntime` is no longer needed — runtime inference moved to the CLI based on `entry_point` file extension.

- **`status.proto`**: Replaced `ResourceChangeRecord` with `ApiResourceReference` in `ReconciliationSummary`. Same type as `spec.members` for consistency. Deleted the `ResourceChangeRecord` message.

- **`api.proto`**: Rewrote `Project` message documentation with examples for both declarative and SDK tracks.

### Generated Stubs

- Go stubs regenerated via `buf generate` — `ProjectSpec` struct now has 3 fields
- Python stubs regenerated — type stubs updated
- All pass `buf lint` and `buf format`

## Benefits

- **Simpler data model**: Resources have one authoritative location. The project stores only references.
- **Enables declarative track**: CLI can scan a directory for YAML files, apply each individually, and send references — no need to parse into embedded proto objects.
- **Simpler reconciliation**: Set-difference on references replaces dependency-graph-based deep diff.
- **Fewer types**: `ResourceChangeRecord` eliminated in favor of existing `ApiResourceReference`.
- **Cleaner API surface**: 3 fields instead of 7, one import instead of six.

## Impact

- **Proto API**: Breaking change — `ProjectSpec` shape is fundamentally different
- **Backend**: Reconciliation service, execution engine, and controller need updates (Phase 2)
- **CLI**: Project apply flow needs adaptation for both SDK and declarative tracks (Phases 3-4)
- **No users affected**: Platform is pre-launch, no backward compatibility needed

## Related Work

- Part of project `20260227.01.project-declarative-track`
- Phase 1 of 5 in T01 (Redesign ProjectSpec to References + Declarative Directory Scanning)
- Next: Phase 2 — Backend Reconciliation Simplification

---

**Status**: In Progress (Phase 1 of 5 complete)
**Commit**: `c2e69995`
