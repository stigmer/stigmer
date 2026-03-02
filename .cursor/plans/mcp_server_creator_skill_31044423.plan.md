---
name: MCP server creator skill
overview: Update `04_draft-mcp-server-creator-skill.sh` to match the quality and workspace-aware pattern established by `02_draft-agent-creator-skill.sh`, giving the skill-generation agent full repository context, changelog exploration, and product doc access — so the regenerated mcp-server-creator skill is grounded in the same deep domain understanding as the agent-creator skill.
todos:
  - id: update-script
    content: Rewrite 04_draft-mcp-server-creator-skill.sh with workspace access, temp-file message, env injection, and upgraded prompt
    status: completed
  - id: verify-structure
    content: Verify the updated script has structural parity with 02_draft-agent-creator-skill.sh (same patterns, same safety mechanisms)
    status: completed
isProject: false
---

# Upgrade MCP Server Creator Skill Generation Script

## The Problem

The current `[seedpack/tools/04_draft-mcp-server-creator-skill.sh](seedpack/tools/04_draft-mcp-server-creator-skill.sh)` is significantly less capable than `[seedpack/tools/02_draft-agent-creator-skill.sh](seedpack/tools/02_draft-agent-creator-skill.sh)`. The differences:


| Capability                            | Agent Creator (02)         | MCP Server Creator (04)    |
| ------------------------------------- | -------------------------- | -------------------------- |
| `--workspace` (repo access)           | Yes                        | **No**                     |
| `--env OUTPUT_DIR`                    | Yes                        | **No**                     |
| Explores `_changelog/`                | Yes                        | **No**                     |
| Browses `docs/product/what-is-*.md`   | Yes                        | **No**                     |
| Attaches authoritative product doc    | Yes (`what-is-agent.md`)   | **No**                     |
| Ignores existing skill content        | Yes (explicit instruction) | **No**                     |
| Message via temp file (bash 3.2 safe) | Yes                        | **No** (inline heredoc)    |
| ANTHROPIC_API_KEY hard-check          | No                         | Yes (unnecessary coupling) |


The existing mcp-server-creator skill was generated without workspace context, meaning the agent that produced it had no access to changelogs, product docs, or the broader platform understanding that makes the agent-creator skill so well-grounded.

## The Changes

### 1. Add workspace access

```bash
stigmer draft skill \
  --workspace "$REPO_ROOT" \      # NEW
  --attach "$MCPSERVER_DIR" \
  --attach "$AGENT_DIR" \
  --attach "$ENVIRONMENT_DIR" \
  --attach "$SKILL_CREATOR_SKILL" \
  --attach "$WHAT_IS_MCP_SERVER_DOC" \  # NEW
  --output "$SKILLS_DIR" \
  --env "OUTPUT_DIR=seedpack/skills" \  # NEW
  --model claude-sonnet-4.6 \
  -m "$(cat "${_MSG_FILE}")"
```

### 2. Attach `what-is-mcp-server.md` as spotlight context

Add a new config variable and verification:

```bash
readonly WHAT_IS_MCP_SERVER_DOC="${REPO_ROOT}/docs/product/what-is-mcp-server.md"
```

This is the authoritative conceptual document for the McpServer resource, analogous to `what-is-agent.md` for the agent-creator.

### 3. Remove the `ANTHROPIC_API_KEY` hard-check

The agent-creator script does not have this check. The CLI and server handle provider configuration; the script should not assume a specific provider. This is an unnecessary coupling that the agent-creator script correctly avoids.

### 4. Use temp-file pattern for the message

Replace the inline heredoc with the temp-file approach from 02 to avoid bash 3.2's `$()` + heredoc parsing bug (which breaks on apostrophes). This is a reliability fix.

### 5. Rewrite the prompt

The new prompt will instruct the generating agent to:

- **Explore `_changelog/`** for how the McpServer, Environment, and Agent resources have evolved (focus on 2026-02 and 2026-03 entries touching MCP server config, discovery, approval policies, or credential handling)
- **Treat attached protos as canonical truth** for every field, validation rule, and enum value
- **Browse `docs/product/what-is-*.md`** for related concepts (start with the attached `what-is-mcp-server.md`, then explore `what-is-agent.md`, `what-is-environment.md`, `what-is-agent-execution.md`, etc.)
- **Ignore existing content** in `seedpack/skills/mcp-server-creator/` — regenerating from scratch
- **Follow the skill-creator skill's guidance** on structure (SKILL.md + progressive disclosure to `references/`)

The prompt will retain the six critical behaviors from the current script but integrate them more naturally with the workspace exploration context:

1. Understand the MCP Server (gather user intent before writing YAML)
2. Choose the right server type (stdio vs http decision guide)
3. Configure environment variables (env_spec with accurate descriptions and is_secret)
4. Set sensible defaults (default_enabled_tools and default_tool_approvals)
5. Validate thoroughly (all proto-derived validation rules)
6. Explain agent integration (how agents reference via mcp_server_usages)

### 6. Update echo output to reflect new inputs

The script's informational output should list the workspace and the attached `what-is-mcp-server.md` doc.

## Files Changed

- `[seedpack/tools/04_draft-mcp-server-creator-skill.sh](seedpack/tools/04_draft-mcp-server-creator-skill.sh)` — the only file modified

## What This Does NOT Do

- Does not modify the existing `seedpack/skills/mcp-server-creator/` directory. The script will clean and regenerate it when run.
- Does not change any protos, docs, or other skills.
- Does not run the script — it prepares it for the user to run at their discretion.

## Design Decisions

- **Parallel structure with 02**: The two scripts should be structurally parallel — same patterns, same safety mechanisms, same level of prompt quality. This makes the toolset consistent and maintainable.
- **Temp file for message**: Bash 3.2 (macOS default) has a known parsing bug with apostrophes inside `$( ... <<'EOF' ... EOF)`. The agent-creator script solved this with a temp file + trap. We adopt the same pattern.
- **No ANTHROPIC_API_KEY check**: The CLI abstracts provider selection. If the user needs Anthropic, they configure the server. The script should not assume.

