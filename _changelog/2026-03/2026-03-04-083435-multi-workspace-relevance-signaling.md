# Multi-Workspace Relevance Signaling

**Date**: March 4, 2026

## Summary

Relevance signaling now resolves file path candidates from the user's message against all workspace entry roots, not just the primary. Agents in multi-workspace sessions receive accurate file hints regardless of which entry a referenced file lives in, with entry-name annotations for disambiguation.

## Problem Statement

When `20260304.01` added multi-source workspace support (multiple `--workspace` entries), the relevance signaling pipeline was not adapted. `build_relevance_prompt_section` received only `provision_results[0].root_dir`, meaning paths in the second, third, or later workspace entries were silently ignored. The agent never learned about them.

### Pain Points

- User references `config.yaml` that exists in the second workspace entry — agent's system prompt contains no hint about it
- User references files across multiple entries — only files in the primary entry appear in the "Potentially Relevant Files" section
- No way for the agent to distinguish which entry a file was resolved from

## Solution

Widened the workspace root parameter from a single `str` to a `Sequence[WorkspaceRoot]` across the relevance pipeline. Each candidate path is tried against roots in provision order; the first existing match wins and is stamped with that entry's name. The three-function architecture (`extract` -> `resolve` -> `format`) is preserved.

## Implementation Details

**New value object** — `WorkspaceRoot(name, root_dir)` frozen dataclass in `relevance.py`. Keeps the module dependency-free from the provisioner; the caller maps `ProvisionResult` to `WorkspaceRoot` at the call site.

**Updated `ResolvedPath`** — gained `entry_name: str = ""` field. Default empty string preserves backward compatibility for single-workspace sessions.

**First-match-wins resolution** — for each candidate, the inner loop iterates roots in order. On the first `isdir()` or `isfile()` hit, the resolved path is appended with that root's name and the loop breaks. This prevents duplicate entries when the same relative path exists in multiple entries.

**Entry annotation in prompt** — `_format_resolved_path` appends ` — in **{entry_name}**` when the name is non-empty. Single-workspace output is unchanged.

**Call site** — `execute_graphton.py` builds `workspace_roots` from all `provision_results` via a list comprehension, replacing the previous `provision_results[0].root_dir` single-root pattern.

### Files Changed

| File | Change |
|------|--------|
| `backend/services/agent-runner/worker/activities/relevance.py` | `WorkspaceRoot` VO, `entry_name` on `ResolvedPath`, multi-root resolution loop, entry annotation formatting |
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Import `WorkspaceRoot`, build roots list from all `provision_results` |
| `backend/services/agent-runner/tests/test_relevance.py` | Updated 50 existing tests, added 10 new multi-root tests |

## Benefits

- Agents now see file hints from **all** workspace entries, not just the primary
- Entry-name annotations help agents navigate multi-workspace sessions without guessing which entry a file belongs to
- Single-workspace sessions produce identical output — zero regression risk
- 1082 agent-runner tests pass with no regressions

## Impact

- **Agent quality**: Multi-workspace agents start with better file awareness, reducing wasted tool calls for file discovery
- **User experience**: When users reference files from any workspace entry, the agent immediately knows about them
- **Architecture**: Clean value-object boundary (`WorkspaceRoot`) keeps the relevance module decoupled from provisioning internals

## Related Work

- Predecessor: `2026-03-04-082306-discourage-tool-alias-usage.md` (T01 of the same project)
- Project: `20260304.03.multi-workspace-agent-polish`
- Next: T03 (runtime `.gitignore` for multi-workspace), T04 (multi-workspace system prompt improvements)

---

**Status**: Production Ready
**Commit**: `a7468869`
