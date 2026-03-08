# Dependency-Aware Resource Apply Ordering

**Date**: March 8, 2026

## Summary

Added dependency-aware sorting to the CLI's resource apply pipeline so that MCP servers are always created before agents, and agents before workflows. This ensures that the `MergeMcpServerEnvSpecs` pipeline step (and any future cross-resource wiring) can resolve references on the very first apply — no second pass required.

## Problem Statement

The CLI's `stigmer apply` command scanned project directories using `os.ReadDir()`, which returns entries in **filesystem alphabetical order**. This meant `agents/` was processed before `mcp-servers/`, causing agents to be created/updated before their referenced MCP servers existed in the store.

### Pain Points

- The `MergeMcpServerEnvSpecs` pipeline step could not find referenced MCP servers during agent creation, because those servers hadn't been applied yet
- A second `stigmer apply` was required to populate the agent's `env_spec` — violating the principle that a single apply should produce a correct, complete state
- Both the seedpack bootstrap (embedded system resources) and user project applies were affected
- The `stigmer apply -f <directory>` command had the same ordering issue via `filepath.Walk`

## Solution

Introduced a stable, dependency-aware sort on the `applyItem` slice before any resources are sent to the backend. The sort uses a static priority map that encodes the resource dependency graph:

| Priority | Kind         | Rationale                                           |
|----------|--------------|-----------------------------------------------------|
| 0        | Organization | Root of the hierarchy, no dependencies              |
| 1        | MCP Server   | Declares env vars consumed by agents                |
| 2        | Agent        | References MCP servers and skills; referenced by workflows |
| 3        | Workflow     | References agents                                   |

Skills are already pushed in a separate phase (Phase 5a) before any YAML resources, so they don't appear in this ordering.

## Implementation Details

### Changes

**`client-apps/cli/cmd/stigmer/root/apply_file.go`**
- Added `applyKindOrder` map defining the static priority for each resource kind
- Added `sortItemsByApplyOrder()` function using `sort.SliceStable` to preserve relative order within the same kind
- Applied the sort in `executeFileApply()` after collecting all items

**`client-apps/cli/cmd/stigmer/root/apply_declarative.go`**
- Applied the same `sortItemsByApplyOrder()` call in `executeDeclarativeApply()` after `detectResourceItems()` returns

### Design Decisions

- **Stable sort**: Items of the same kind retain their original filesystem order, making the behavior predictable and debuggable
- **Static priority map**: Simple, explicit, and easy to extend when new resource kinds are added
- **Unknown kinds default to priority 99**: Future resource kinds are applied last unless explicitly added to the priority map — safe default
- **Single sort function, two call sites**: The sort function lives in `apply_file.go` (where `applyItem` is defined) and is called from both apply paths

## Benefits

- **Single-pass correctness**: `stigmer apply` produces a fully-wired state on the first run — no need for a second apply
- **Seedpack bootstrap fixed**: Embedded system resources (agent-creator, etc.) get their MCP server env_specs merged on first daemon startup
- **Zero behavioral change for correctly-ordered projects**: The sort is stable and only reorders across kinds, not within them
- **Minimal code footprint**: ~30 lines of new code, no new files, no new dependencies

## Impact

- **CLI users**: `stigmer apply --config <project-dir>` and `stigmer apply -f <dir>` now produce correct results regardless of directory naming
- **Seedpack bootstrap**: System agents get their env_spec populated on first startup without requiring a hash-bust or second bootstrap pass
- **Future resource kinds**: The pattern is extensible — adding a new kind to `applyKindOrder` is a one-line change

## Related Work

- [Auto-Merge MCP Server env_spec into Agent](2026-03-08-153740-merge-mcp-server-env-specs-into-agent.md) — the pipeline step that depends on this ordering fix

---

**Status**: ✅ Production Ready
