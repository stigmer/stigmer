# Fix Skill-Creator Output Path Hardcoded to Workspace Root

**Date**: March 2, 2026

## Summary

Replaced the hardcoded workspace-root output path in the `skill-creator` system agent with a declared, overridable `OUTPUT_DIR` environment variable using the platform's existing `env_spec` mechanism. This makes the platform-provided agent reusable across different output contexts without instruction changes.

## Problem Statement

The `skill-creator` agent — a platform-provided, reusable system agent — hardcoded workspace root (`.`) as the output directory in its instructions. This meant every skill created by this agent would always land at the workspace root, regardless of what the caller intended.

### Pain Points

- The `init_skill.py --path .` command in the agent instructions hardcoded the output location
- The prose instruction "New skill files you create go in the workspace root" reinforced this behavior
- The CLI's `--output` flag only controls post-execution artifact download, not where the agent writes — so callers had no way to influence agent-side output placement
- The `02_draft-agent-creator-skill.sh` script passed `--output seedpack/skills/` expecting the skill to land there, but the agent wrote to workspace root instead

## Solution

Used the platform's existing `env_spec` mechanism to declare `OUTPUT_DIR` as a configurable environment variable on the agent with a sensible default of `.` (workspace root).

The agent instructions now reference `$OUTPUT_DIR` instead of hardcoding `.`, and callers override it via `--env OUTPUT_DIR=path` using the existing `--env` flag available on all draft commands.

This approach:
- Uses existing infrastructure (`env_spec` on Agent proto, `--env` on CLI)
- Keeps the default experience unchanged for interactive users
- Makes the behavior explicit and contractual (declared in the agent YAML)
- Works in both local and cloud environments (workspace-relative paths)

## Implementation Details

### `seedpack/agents/skill-creator.yaml`

- Added `env_spec` declaring `OUTPUT_DIR` with default `.` and description
- Updated path convention text to reference `$OUTPUT_DIR`
- Changed scaffold command from `--path .` to `--path $OUTPUT_DIR`
- Changed package command from `./<skill-name>` to `$OUTPUT_DIR/<skill-name>`

### `seedpack/tools/02_draft-agent-creator-skill.sh`

- Added `--env "OUTPUT_DIR=seedpack/skills"` to the `stigmer draft skill` invocation
- Uses a workspace-relative path (not absolute) for portability

### Cleanup

- Removed stale `agent-creator/` directory from repo root that was created by a previous run hitting the hardcoded workspace-root behavior

## Benefits

- Platform-provided agent is now context-agnostic — works wherever the caller directs it
- Scripts can control output location cleanly via `--env`
- Interactive users get the same default behavior (workspace root)
- Pattern is consistent with how MCP servers use `env_spec` for credentials

## Impact

- **skill-creator agent**: Output path is now configurable via `OUTPUT_DIR`
- **Draft scripts**: Can target specific output directories without working around hardcoded behavior
- **Other creator agents**: `agent-creator` and `mcp-server-creator` can adopt the same pattern if needed

---

**Status**: Production Ready
