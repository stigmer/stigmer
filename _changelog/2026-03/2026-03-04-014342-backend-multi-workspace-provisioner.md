# Backend Multi-Workspace Provisioner (Phase 3 MVP)

**Date**: March 4, 2026

## Summary

Implemented multi-workspace provisioning in the Python agent-runner backend, enabling sessions to provision and describe multiple local-path workspace entries. This completes the MVP milestone for the multi-source workspace feature — local multi-path workspaces now work end-to-end from CLI through backend provisioning to system prompt generation.

## Problem Statement

The agent-runner backend was hardcoded to provision a single workspace source per session. With the proto schema (Phase 1) and CLI (Phase 2) already supporting multiple `WorkspaceEntry` objects, the backend needed to iterate entries, provision each one, and generate a coherent multi-entry system prompt.

### Pain Points

- `WorkspaceProvisioner.provision()` handled only a single `WorkspaceSource` — no way to provision multiple entries
- `ProvisionResult` had no identity field — couldn't distinguish which entry a result belonged to
- `build_workspace_prompt_section()` accepted a single `ProvisionResult | None` — couldn't describe multiple workspaces
- `execute_graphton.py` read the now-reserved `workspace_source` field instead of the new `workspace_entries` repeated field
- Consumed keys, backend replacement, heartbeat data, and git diff generation were all singular

## Solution

Extended the existing domain types and orchestration layer to handle multiple workspace entries while preserving exact backward compatibility for single-entry sessions.

## Implementation Details

### Domain Layer (`provisioner.py`)

- **`ProvisionResult.entry_name`**: Added `entry_name: str = ""` as the last field on the frozen dataclass. The default ensures all existing construction sites (empty, local_path, git source handlers, tests) continue to work unchanged. The name is stamped by `provision_all()` after delegation, not by the source handlers.

- **`WorkspaceProvisioner.provision_all()`**: New method that accepts a `Sequence[object]` of `WorkspaceEntry` protos (duck-typed via `.name` and `.source`), iterates them, delegates each to the existing `provision()` method, and stamps `entry_name` using `dataclasses.replace()`. Implements fail-fast — any provisioning error propagates immediately.

### System Prompt Generation (`execute_graphton.py`)

- **`build_workspace_prompt_section()`**: Signature changed from `ProvisionResult | None` to `list[ProvisionResult] | None`. Dispatches to `_build_single_workspace_section()` (preserves legacy format exactly) or `_build_multi_workspace_section()` (generates a preamble naming the primary entry + per-entry `###` headings + adjusted `####` file tree headings).

### Activity Wiring (`execute_graphton.py`)

- Replaced `session.spec.HasField("workspace_source")` with `if session.spec.workspace_entries:`
- Called `provisioner.provision_all()` instead of `provisioner.provision()`
- Updated backend replacement to use primary entry's `root_dir`
- Aggregated `consumed_keys` from all results via set union
- Updated heartbeat with `entry_count`, `source_types`, `primary_root_dir`
- Changed git diff generation to loop over all provision results
- Changed relevance section to use primary workspace root

### Tests

- **7 new `TestProvisionAll` tests**: empty entries, single entry, multiple entries, name stamping, consumed keys propagation, fail-fast behavior, backward compatibility of `provision()`.
- **7 new `TestMultiEntryWorkspacePromptSection` tests**: dual paths, preamble content, entry headings, tree heading adjustment, single-entry legacy equivalence, formatting, entry count.
- **44 existing tests migrated** from singular to list API — all pass without behavioral changes.

## Benefits

- **MVP milestone reached**: Local multi-path workspaces work end-to-end (`stigmer run -w /path/a -w /path/b`)
- **Zero regression risk**: Single-entry sessions produce byte-identical output to before
- **Clean extension point**: `provision_all()` requires no changes for Phase 4 (git repos) — the git source handler already works through `provision()` dispatch
- **No new types**: Extended `ProvisionResult` instead of introducing `EntryProvisionResult`, keeping the domain model lean

## Impact

- **Agent runners**: Can now receive and provision multiple workspace entries from a session
- **Agent system prompts**: Describe multiple workspaces with clear per-entry headings and navigation instructions
- **End users**: Can pass multiple `-w` flags and have the agent see all workspaces (local mode)
- **Future phases**: Phase 4 (git multi-repo) and Phase 5 (integration tests) build directly on this foundation

## Related Work

- [Multi-Source Workspace Proto Schema](2026-03-04-005215-multi-source-workspace-proto-schema.md) — Phase 1
- [CLI Multi-Workspace Support](2026-03-04-011542-cli-multi-workspace-support.md) — Phase 2

---

**Status**: ✅ Production Ready (local paths)
**Timeline**: 1 session (~2 hours)
