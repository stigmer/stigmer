# Seedpack Public Visibility and OUTPUT_DIR Cleanup

**Date**: March 21, 2026

## Summary

Made all seedpack resources (agents, MCP server) public by adding `visibility: visibility_public` to their metadata, and removed the redundant `OUTPUT_DIR` environment variable concept from all creator agents. This simplifies the agent definitions and eliminates a confusing indirection layer between the agent's sandbox and the CLI's artifact download mechanism.

## Problem Statement

### Pain Points

- Seedpack agents (`agent-creator`, `skill-creator`, `mcp-server-creator`) and the MCP server (`mcp-server-stigmer`) were missing `visibility` in their metadata, defaulting to private. As system resources meant to be available to all users, they should be public.
- All three creator agents declared an `OUTPUT_DIR` environment variable in their `env_spec` with a default value of `"."` (workspace root). This was redundant because:
  - The default is always `"."` — the agent writes to the workspace root regardless.
  - The CLI's `--output` flag (which controls where artifacts are downloaded locally) is a completely separate concept that is not wired to `OUTPUT_DIR`.
  - Having two disconnected "output directory" concepts (`OUTPUT_DIR` for the sandbox, `--output` for CLI download) created confusion about what each controls.
- Build scripts in `seedpack/tools/` passed `--env "OUTPUT_DIR=seedpack/skills"` which became a no-op after the agent instructions were updated.

## Solution

1. Added `visibility: visibility_public` to the metadata of `agent-creator`, `skill-creator`, `mcp-server-creator`, and `mcp-server-stigmer`. The `assistant` agent already had this set.
2. Removed the `env_spec` block (containing `OUTPUT_DIR`) from all three creator agents.
3. Updated all agent instructions to replace `$OUTPUT_DIR/<name>` references with direct workspace-relative paths (e.g., `<agent-name>.yaml` in the workspace root).
4. Removed dead `--env "OUTPUT_DIR=..."` flags from the build scripts.

## Implementation Details

### Files Changed

- `seedpack/agents/agent-creator.yaml` — added visibility, removed env_spec, updated 5 instruction references
- `seedpack/agents/skill-creator.yaml` — added visibility, removed env_spec, updated 4 instruction references (including `init_skill.py --path .` and `package_skill.py <skill-name>`)
- `seedpack/agents/mcp-server-creator.yaml` — added visibility, removed env_spec, updated 5 instruction references
- `seedpack/mcp-servers/mcp-server-stigmer.yaml` — added visibility
- `seedpack/tools/02_draft-agent-creator-skill.sh` — removed `--env "OUTPUT_DIR=seedpack/skills"`
- `seedpack/tools/03_draft-mcp-server-creator-skill.sh` — removed `--env "OUTPUT_DIR=seedpack/skills"`

### Design Decision: OUTPUT_DIR vs --output

Investigation revealed that `OUTPUT_DIR` (agent env var) and `--output` (CLI flag) are completely disconnected concepts:

| Concept | Layer | Purpose |
|---------|-------|---------|
| `OUTPUT_DIR` | Backend sandbox | Where the agent writes files inside its workspace |
| `--output` | CLI | Where the CLI downloads artifacts to the user's local machine |

Since `OUTPUT_DIR` always defaulted to `"."` and was never overridden in practice, removing it simplifies the mental model to a single concept: the CLI's `--output` flag controls where files end up on the user's machine.

## Benefits

- All seedpack resources are now properly marked as public, matching their intended access pattern
- Simpler agent definitions — no unnecessary env_spec boilerplate
- Clearer mental model — one output concept (`--output` on CLI) instead of two disconnected ones
- Agent instructions are more straightforward — "write to the workspace root" instead of "write to `$OUTPUT_DIR`"

## Impact

- Seedpack bootstrap will now create all resources as public
- Existing installations will need a re-bootstrap (`stigmer apply -f seedpack/`) to pick up visibility changes
- No behavioral change for agent execution — agents already wrote to workspace root by default

---

**Status**: Production Ready
