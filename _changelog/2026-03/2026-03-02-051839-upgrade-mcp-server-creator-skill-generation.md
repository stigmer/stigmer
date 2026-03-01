# Upgrade MCP Server Creator Skill Generation Script

**Date**: March 2, 2026

## Summary

Upgraded `03_draft-mcp-server-creator-skill.sh` (formerly `04_`) to match the workspace-aware, context-rich pattern established by the agent-creator skill generation script. The generating agent now has full repository access and deep domain context, producing a skill grounded in changelogs, product docs, and proto schemas rather than isolated attachments alone.

## Problem Statement

The MCP server creator skill generation script was significantly less capable than its agent-creator counterpart. The agent that produced the mcp-server-creator skill had no access to the repository workspace, changelogs, or product documentation — only the raw proto directories and the skill-creator skill. This meant it could not:

### Pain Points

- Explore `_changelog/` to understand how the McpServer resource evolved over time
- Browse `docs/product/what-is-*.md` to build cross-cutting domain understanding
- Reference the authoritative `what-is-mcp-server.md` conceptual document
- Be explicitly told to ignore existing skill content and regenerate from scratch
- The script also had an unnecessary `ANTHROPIC_API_KEY` hard-check that coupled it to a specific LLM provider, and used an inline heredoc pattern that breaks on bash 3.2 (macOS default)

## Solution

Brought the script to full structural parity with `02_draft-agent-creator-skill.sh`:

1. Added `--workspace "$REPO_ROOT"` for full repository exploration
2. Attached `what-is-mcp-server.md` as spotlight context
3. Added `--env "OUTPUT_DIR=seedpack/skills"` for output path injection
4. Rewrote the prompt with workspace exploration instructions (changelog, product docs, proto-as-truth, ignore-existing-content)
5. Switched to the temp-file message pattern (`mktemp` + `trap`) for bash 3.2 compatibility
6. Removed the `ANTHROPIC_API_KEY` environment variable check
7. Renumbered from `04_` to `03_` to fill the gap left by the removed agent-creator agent script

## Implementation Details

### Files Changed

- `seedpack/tools/04_draft-mcp-server-creator-skill.sh` → `seedpack/tools/03_draft-mcp-server-creator-skill.sh` (renamed + rewritten)
- `seedpack/tools/regenerate_all.sh` (updated references and comments)

### Key Prompt Additions

The generating agent is now instructed to:
- Explore `_changelog/` entries from 2026-02 and 2026-03 touching MCP server config, discovery, approval policies, and credential handling
- Treat attached proto schemas as canonical source of truth, verified against the product doc
- Browse `docs/product/what-is-*.md` for cross-cutting domain understanding
- Explicitly ignore existing `seedpack/skills/mcp-server-creator/` content

## Benefits

- The regenerated mcp-server-creator skill will have the same depth of domain grounding as the agent-creator skill
- Consistent script patterns across the seedpack tools reduce maintenance burden
- Removing the provider-specific check makes the script portable across LLM backends
- Bash 3.2 compatibility prevents silent failures on macOS

## Impact

Affects the seedpack skill generation pipeline. The existing mcp-server-creator skill content is not modified — it will be regenerated when the script is next run.

## Related Work

- `02_draft-agent-creator-skill.sh` — the reference pattern this script now mirrors
- `2026-03-02-050509-hand-write-agent-creator-agent.md` — removed `03_` agent script, freeing the number slot

---

**Status**: ✅ Production Ready
