# Workspace Provisioning Proto Foundation (Phase 1)

**Date**: February 27, 2026

## Summary

Added `WorkspaceSource` and `GitRepoSource` proto messages to the session package, establishing the wire-protocol types for workspace provisioning. This is the foundational schema that enables agents to work with git-backed workspaces -- a prerequisite for the full workspace provisioning feature that will make agent execution deployment-agnostic.

## Problem Statement

Stigmer agents today always operate in empty, isolated session workspaces. There is no way to point an agent at an existing git repository. This limits the platform's usefulness for real-world software engineering tasks where agents need to work within existing codebases.

### Pain Points

- No `WorkspaceSource` concept on sessions -- agents cannot be told "work in this git repo"
- No proto-level representation of git repository coordinates (URL, branch, commit, depth)
- The schema gap blocks all downstream workspace provisioning work (provisioner module, execution flow integration, system prompt awareness)

## Solution

Introduced two new proto messages in the `session/v1` package and extended `SessionSpec` with an optional `workspace_source` field:

- `WorkspaceSource` -- discriminated union (oneof) representing the source of workspace content
- `GitRepoSource` -- git repository coordinates with HTTPS URL validation, branch/commit targeting, and configurable clone depth

The design is purely additive and fully backward-compatible: existing sessions without `workspace_source` continue to use empty workspaces.

## Implementation Details

### New Proto File: `workspace.proto`

Created `apis/ai/stigmer/agentic/session/v1/workspace.proto` containing:

- **`WorkspaceSource`**: Wrapper with required `oneof source` (currently `git_repo`; extensible for future sources). The oneof is required so an empty `WorkspaceSource{}` is an invalid state -- the "no workspace" case is represented by the absence of `workspace_source` on `SessionSpec`.

- **`GitRepoSource`**: Four fields:
  - `url` (required, HTTPS-only via CEL validation)
  - `branch` (optional, defaults to repo's default branch)
  - `commit` (optional, pins to exact SHA in detached HEAD)
  - `depth` (optional via proto3 `optional` keyword, absent = shallow depth 1, 0 = full clone)

### Key Architectural Decisions

1. **`optional int32` over `google.protobuf.Int32Value`** for `depth` -- the codebase has zero wrapper type usage. `optional` is the modern proto3 approach and provides identical presence-tracking without a new dependency pattern.

2. **Separate `branch` + `commit` over single `ref`** -- diverges intentionally from the `Git` message in `skill/v1/synth.proto`. Workspace provisioning needs both concepts (which branch to clone vs which commit to pin to) as distinct operations.

3. **CEL expression for HTTPS validation** -- follows the established buf-validate CEL pattern used elsewhere in the codebase.

4. **Local path excluded from proto** (AD-09) -- `local_path` is a runner-level concern, not a wire-protocol concept.

### Modified File: `spec.proto`

Added `WorkspaceSource workspace_source = 6` to `SessionSpec` with appropriate documentation.

### Generated Stubs

- Go: `workspace.pb.go` (Gazelle auto-added to BUILD.bazel)
- Python: `workspace_pb2.py`, `workspace_pb2.pyi`

## Benefits

- Establishes the wire-protocol foundation for all workspace provisioning work
- Enables Phase 2 (provisioner module) and downstream phases to begin
- Zero breaking changes -- fully backward-compatible with existing sessions
- Clean, extensible schema that supports future workspace source types

## Impact

- **APIs**: New messages in `session/v1` package, new field on `SessionSpec`
- **Generated stubs**: Go and Python stubs updated
- **Downstream**: No runtime code changes yet -- this is schema-only. The provisioner, execution flow, and system prompt integration will consume these types in subsequent phases.

## Related Work

- Part of the **20260227.02.workspace-provisioning** project
- Phase 1 of 6 phases (Phase 0: refactor, Phase 2: provisioner, Phase 3: integration, Phase 4: system prompt, Phase 5: local-mode optimization)
- Design decisions documented in `_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/`

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
