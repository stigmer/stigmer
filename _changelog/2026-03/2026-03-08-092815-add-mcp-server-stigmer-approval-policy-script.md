# Add mcp-server-stigmer Approval Policy Generation Script

**Date**: March 8, 2026

## Summary

Added a new seedpack tool script (`04_generate-approval-policy.sh`) that generates `default_tool_approvals` for the `mcp-server-stigmer` MCP server by querying its discovered capabilities from the Stigmer backend. The script includes strict scoping to prevent the agent from querying or referencing any other MCP server.

## Problem Statement

The `mcp-server-stigmer` seedpack YAML lacked an automated way to generate approval policies for its tools. Without explicit `default_tool_approvals`, destructive or mutating operations (delete, destroy, apply, etc.) could be executed without human review.

### Pain Points

- No scripted workflow to generate approval policies for the built-in Stigmer MCP server
- Risk of the agent wandering into other MCP servers' data when generating policies
- No guardrail to prevent the agent from guessing tool names if discovery returns empty results

## Solution

Created `seedpack/tools/04_generate-approval-policy.sh` following the established pattern from the agent-fleet's Planton approval policy script. The agent prompt includes:

1. **Hard scope constraint** — only query `mcp-server-stigmer`, ignore everything else
2. **Fail-fast instruction** — if discovery returns nothing, stop and report; do not search the workspace or guess tool names
3. **Step-by-step classification** — retrieve tools, classify safe vs mutating, generate approval entries with `{{args.<field>}}` placeholders, group by domain

## Implementation Details

- New file: `seedpack/tools/04_generate-approval-policy.sh`
  - Applies the McpServer YAML to trigger auto-discovery
  - Passes a detailed, scoped prompt to `stigmer draft mcp-server`
  - Includes the same tempfile + trap pattern as sibling scripts
- Updated `seedpack/tools/regenerate_all.sh` to include the new script as step 04

## Benefits

- Automated, repeatable approval policy generation for the Stigmer MCP server
- Strict scoping prevents cross-contamination from other MCP servers
- Fail-fast behavior avoids hallucinated tool names when discovery data is unavailable
- Consistent with the agent-fleet pattern, making both repos follow the same conventions

## Impact

- Seedpack maintainers can now run `./tools/04_generate-approval-policy.sh` or `./tools/regenerate_all.sh` to produce approval policies for `mcp-server-stigmer`
- The `regenerate_all.sh` pipeline now covers all four seedpack generation steps

## Related Work

- Agent-fleet `tools/01_generate-approval-policy.sh` (same pattern for `mcp-server-planton`)
- Seedpack `tools/03_draft-mcp-server-creator-skill.sh` (sibling script in the pipeline)

---

**Status**: ✅ Production Ready
