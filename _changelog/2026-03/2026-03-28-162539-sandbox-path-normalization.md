# Sandbox Path Normalization — Three-Layer Defense Against Infrastructure Leak

**Date**: March 28, 2026

## Summary

Shell tool cards displayed raw sandbox paths like `/home/daytona/workspace/plantonhq/`, exposing Daytona infrastructure details to end users and platform builders. This implementation prevents the leak at three layers: the agent prompt (root cause), the backend data-humanization pipeline (comprehensive fix), and the SDK (safety net for historical data). The architecture mirrors the established `humanize_platform_refs` pattern already in production for `.stigmer/` path display.

## Problem Statement

When the agent executed shell commands in a cloud (Daytona) sandbox, the full absolute path `/home/daytona/workspace/…` appeared in:

- **ToolCallItem subtitle** (collapsed tool row)
- **ShellArgsView command block** (expanded tool detail and approval cards)
- **ShellToolDetail output section** (command stdout/stderr)
- **Streaming progress chunks** (live output)

### Pain Points

- Reveals backend infrastructure details (Daytona sandbox provider, directory structure)
- Unprofessional for a platform-for-platforms — platform builders embedding Stigmer would expose their vendor's internals to their own users
- Confusing to end users who have no context for `/home/daytona/workspace`
- The paths are meaningless outside the sandbox — they don't help users understand what the agent is doing

## Solution

Three-layer defense-in-depth, each with a distinct role:

1. **Layer 1 (Prompt)**: Stop telling the LLM absolute sandbox paths, so it generates relative commands naturally
2. **Layer 2 (Data Humanization)**: Normalize stored display data in the existing StatusBuilder pipeline, so all API consumers (web, CLI, embedders) receive clean paths
3. **Layer 3 (SDK Safety Net)**: Client-side normalization for historical data and edge cases

## Implementation Details

### Layer 1: Agent Prompt — `prompt_builder.py`

- Removed the `**Current working directory**: /home/daytona/workspace` line from the multi-workspace prompt section
- Added `_workspace_relative_path()` helper using `os.path.relpath()` to present entry paths as `plantonhq/agent-fleet` instead of `/home/daytona/workspace/plantonhq/agent-fleet`
- Added explicit instruction: "Do not use absolute filesystem paths"
- Local-path entries (user's actual filesystem) are unaffected — their paths remain meaningful

### Layer 2: StatusBuilder Humanization — `platform_mount.py` + `status_builder.py`

- Created `humanize_sandbox_paths(text, workspace_root)` in `platform_mount.py`, directly alongside `humanize_platform_refs()` — same module, same docstring conventions, same "display strings only" contract
- Three ordered replacements: workspace root prefix → empty (relative path), bare workspace root → `.`, sandbox home → `~`
- No-op when `workspace_root` is empty (local mode)
- Wired into `StatusBuilder._humanize_args_for_display()` as the third step in the humanization chain
- Applied to tool results in `_handle_tool_end_event()` and streaming chunks in `_handle_tool_progress_event()`
- Added `set_workspace_root()` setter, called from `execute_graphton.py`

### Layer 3: SDK Safety Net — React Context + Normalizer

- `sandbox-path-normalizer.ts`: Pure function mirroring the Python implementation
- `SandboxContext.ts`: Context + `useSandboxNormalize()` hook (follows established `FilePathContext` pattern)
- `MessageThread`: New optional `sandboxWorkspaceRoot` prop, wraps children in `SandboxContext.Provider`
- Applied in `ShellArgsView` (commands), `ToolCallItem` (subtitles), `ShellToolDetail` (output)
- `ApprovalCard` is automatically covered through shared `ToolArgsView` → `ShellArgsView`
- All new utilities exported from barrel file for platform builders

### Console Integration — `SessionPage.tsx`

- Detects cloud sessions (any workspace entry with `gitRepo` source)
- Passes well-known `DAYTONA_WORKSPACE_ROOT` constant to `MessageThread`
- Local sessions omit the prop (no normalization)

## Benefits

- **No infrastructure leak**: Users see `ls plantonhq/` instead of `ls /home/daytona/workspace/plantonhq/`
- **All API consumers benefit**: CLI replay, API responses, and third-party embedders all receive clean paths via Layer 2
- **Backward compatible**: Layer 3 normalizes historical data persisted before this fix
- **Zero execution impact**: Normalization only affects display strings — actual sandbox command execution is unaffected
- **Provider-agnostic**: `humanize_sandbox_paths` takes `workspace_root` as a parameter, not hardcoded to Daytona

## Impact

- **End users**: See clean, workspace-relative paths in all shell tool renderings
- **Platform builders**: SDK exports `normalizeSandboxPaths`, `SandboxContext`, and `useSandboxNormalize` for custom tool renderers
- **Backend consumers**: All API responses now have normalized display paths
- **Agent behavior**: LLM naturally generates relative paths from the updated prompt, though absolute paths may still appear and are caught by Layer 2

## Related Work

- Follows the exact pattern of `humanize_platform_refs()` for `.stigmer/` platform paths (already in production)
- Extends the `StatusBuilder._humanize_args_for_display()` humanization chain
- Follows the `FilePathContext` pattern for SDK context architecture

---

**Status**: ✅ Production Ready
**Timeline**: Single session
