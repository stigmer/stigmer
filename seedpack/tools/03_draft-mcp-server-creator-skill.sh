#!/usr/bin/env bash
# ==============================================================================
# draft_mcp_server_creator.sh - Generate the mcp-server-creator skill
# ==============================================================================
#
# Uses `stigmer draft skill` to generate a skill that teaches AI assistants
# to create valid Stigmer McpServer YAML files conforming to the
# agentic.stigmer.ai/v1 API.
#
# The stigmer repository is provided as the workspace so the agent can freely
# explore _changelog/, apis/, and docs/ during generation. Key inputs are also
# explicitly attached as spotlight context:
#   - apis/ai/stigmer/agentic/mcpserver    (proto schemas + docs — primary source of truth)
#   - apis/ai/stigmer/agentic/agent        (proto schemas + docs — for mcp_server_usages)
#   - apis/ai/stigmer/agentic/environment  (proto schemas — for env_spec)
#   - seedpack/skills/skill-creator        (skill authoring guide)
#   - docs/product/what-is-mcp-server.md   (authoritative conceptual doc)
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#
# Usage:
#   ./03_draft-mcp-server-creator-skill.sh
#
# Output:
#   Generated skill saved to ../skills/mcp-server-creator/
#   (relative to this script's location in the seedpack tools/ directory)
#
# ==============================================================================

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SEEDPACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd "${SEEDPACK_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

if ! command -v stigmer &> /dev/null; then
    echo "ERROR: stigmer CLI not found in PATH"
    echo "Build it with: make -C client-apps/cli install"
    exit 1
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

readonly SKILL_NAME="mcp-server-creator"
readonly SKILLS_DIR="${SEEDPACK_DIR}/skills"

readonly MCPSERVER_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/mcpserver"
readonly AGENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/agent"
readonly ENVIRONMENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/environment"
readonly WHAT_IS_MCP_SERVER_DOC="${REPO_ROOT}/docs/product/what-is-mcp-server.md"

readonly SKILL_CREATOR_SKILL="${SKILLS_DIR}/skill-creator"

# Verify spotlight input directories and files exist
for dir in "$MCPSERVER_DIR" "$AGENT_DIR" "$ENVIRONMENT_DIR"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

if [ ! -d "$SKILL_CREATOR_SKILL" ]; then
    echo "ERROR: Skill-creator skill not found: $SKILL_CREATOR_SKILL"
    exit 1
fi

if [ ! -f "$WHAT_IS_MCP_SERVER_DOC" ]; then
    echo "ERROR: File not found: $WHAT_IS_MCP_SERVER_DOC"
    exit 1
fi

# Clean only the target skill directory, preserving siblings.
# The CLI creates a subdirectory named after the artifact inside --output, so we
# point --output at skills/ and let the CLI produce skills/mcp-server-creator/.
rm -rf "${SKILLS_DIR}/${SKILL_NAME}"

echo "=== MCP-Server-Creator Skill Generation ==="
echo "Workspace: ${REPO_ROOT}"
echo "Inputs:    ${MCPSERVER_DIR} (McpServer protos + docs)"
echo "           ${AGENT_DIR} (Agent protos + docs — for understanding mcp_server_usages)"
echo "           ${ENVIRONMENT_DIR} (Environment protos — for env_spec)"
echo "           ${SKILL_CREATOR_SKILL} (skill-creator skill — defines skill authoring format)"
echo "           ${WHAT_IS_MCP_SERVER_DOC}"
echo "Output:    ${SKILLS_DIR}/${SKILL_NAME}/"
echo ""

# ---------------------------------------------------------------------------
# Draft the skill
# ---------------------------------------------------------------------------

# Write the prompt to a temp file to avoid bash 3.2's $() + heredoc parsing
# bug, which breaks on apostrophes inside a heredoc body.
readonly _MSG_FILE="$(mktemp)"
trap 'rm -f "${_MSG_FILE}"' EXIT

cat > "${_MSG_FILE}" <<'EOF'
Create an mcp-server-creator skill that empowers AI assistants to produce valid,
production-quality Stigmer McpServer YAML files conforming to the
agentic.stigmer.ai/v1 API.

You are operating inside the stigmer repository. Use this workspace access
throughout the task:

  - Explore _changelog/ to understand how the McpServer, Environment, and Agent
    resources have evolved. Focus on recent entries (2026-02 and 2026-03) that
    touch MCP server configuration, capability discovery, approval policies,
    credential handling, or environment variable injection.

  - Treat the attached proto schemas (McpServer, Agent, Environment) as the
    canonical source of truth for every field, validation rule, and enum value.
    Do not rely on prose documentation alone -- derive your understanding from
    the protos and verify against the attached what-is-mcp-server.md doc.

  - The workspace contains docs/product/what-is-*.md documents that explain
    each Stigmer concept in depth. Start with the attached what-is-mcp-server.md
    for the McpServer resource itself, then browse the directory for related
    concepts as needed (e.g. what-is-agent.md, what-is-environment.md,
    what-is-skill.md, what-is-agent-execution.md, what-is-agent-instance.md,
    and others). Use these to build a deep understanding of the domain before
    writing the skill.

  - Do NOT read, reference, or be influenced by any content already present in
    seedpack/skills/mcp-server-creator/. You are regenerating this skill from
    scratch. Ignore whatever exists there.

The attached directories contain:
- McpServer resource (protos + docs/ with mcpserver-resource-guide.md,
  server-types.md, tool-approval-policies.md, capability-discovery.md,
  examples.md, validation-checklist.md) -- the primary domain knowledge
  this skill must teach
- Agent resource (protos + docs -- important because agents REFERENCE
  McpServers via mcp_server_usages, so understanding the consumer side
  is essential for the "explain agent integration" step)
- Environment resource (protos -- for understanding env_spec which
  McpServers use to declare required environment variables)
- The skill-creator skill -- the authoritative guide for how to author
  well-structured skills (SKILL.md format, progressive disclosure, bundled
  resources, etc.). Follow its guidance on skill structure

Critical behaviors the generated skill MUST instruct agents to follow:

1. UNDERSTAND THE MCP SERVER: Before writing any YAML, gather the user's
   intent -- what external system does the MCP server connect to, how is it
   started (stdio subprocess vs HTTP endpoint), what credentials does it need,
   and what tools should be available by default.

2. CHOOSE THE RIGHT SERVER TYPE: Guide the user between stdio (most common --
   for npx, python, go CLI-based MCP servers) and http (for remote/managed
   services). Exactly one must be specified.

3. CONFIGURE ENVIRONMENT VARIABLES: Declare all required environment variables
   in env_spec with accurate descriptions and correct is_secret classification.
   Never pre-fill secret values in the spec.

4. SET SENSIBLE DEFAULTS: Help configure default_enabled_tools (which tools
   are available by default) and default_tool_approvals (which tools require
   user approval for destructive operations). Tool names must be verified --
   never guessed.

5. VALIDATE THOROUGHLY: The agent must verify all validation rules (apiVersion,
   kind capitalization, slug format, exactly one server_type, no status fields,
   tool name accuracy, env var placeholder syntax) before presenting the final
   YAML.

6. EXPLAIN THE AGENT INTEGRATION: After creating the McpServer YAML, explain
   how agents reference it via mcp_server_usages -- including enabled_tools
   restrictions and tool_approval_overrides.

Follow the skill-creator skill's guidance on skill structure: concise SKILL.md
with a step-by-step workflow in the body, and reference files for detailed
schemas, examples, and validation checklists. Use progressive disclosure --
keep SKILL.md lean and move detailed reference material into references/ files.

This is a foundational skill for a world-class platform. The output must be
precise, comprehensive, and production-ready. Write the SKILL.md so that any
AI assistant using it can create flawless McpServer YAMLs on the first attempt.
EOF

stigmer draft skill \
  --workspace "$REPO_ROOT" \
  --attach "$MCPSERVER_DIR" \
  --attach "$AGENT_DIR" \
  --attach "$ENVIRONMENT_DIR" \
  --attach "$SKILL_CREATOR_SKILL" \
  --attach "$WHAT_IS_MCP_SERVER_DOC" \
  --output "$SKILLS_DIR" \
  --env "OUTPUT_DIR=seedpack/skills" \
  --model claude-sonnet-4.6 \
  -m "$(cat "${_MSG_FILE}")"

readonly GENERATED_DIR="${SKILLS_DIR}/${SKILL_NAME}"

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: ${GENERATED_DIR}"
echo ""
echo "Next steps:"
echo "  1. Review the generated SKILL.md in ${GENERATED_DIR}"
echo "  2. Validate: python ${SKILLS_DIR}/skill-creator/scripts/quick_validate.py ${GENERATED_DIR}"
echo "  3. Package: python ${SKILLS_DIR}/skill-creator/scripts/package_skill.py ${GENERATED_DIR}"
