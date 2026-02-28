#!/usr/bin/env bash
# ==============================================================================
# draft_mcp_server_creator.sh - Generate the mcp-server-creator skill
# ==============================================================================
#
# Uses `stigmer draft skill` to generate a skill that teaches AI assistants
# to create valid Stigmer McpServer YAML files conforming to the
# agentic.stigmer.ai/v1 API.
#
# This follows the same pattern as 02_draft-agent-creator-skill.sh: we attach
# the canonical proto directories and documentation, give a high-level prompt,
# and let the model decide the skill structure and content.
#
# Inputs are the canonical proto directories (mcpserver, agent, environment),
# the mcpserver docs/ documentation, and the skill-creator skill (which
# defines how to author well-structured skills) — no copies, no duplicates.
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   ./04_draft-mcp-server-creator-skill.sh
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

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY environment variable is not set"
    echo "Set it with: export ANTHROPIC_API_KEY=<your-api-key>"
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

readonly SKILL_CREATOR_SKILL="${SKILLS_DIR}/skill-creator"

# Verify input directories exist
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

# Clean only the target skill directory, preserving siblings.
# The CLI creates a subdirectory named after the artifact inside --output, so we
# point --output at skills/ and let the CLI produce skills/mcp-server-creator/.
rm -rf "${SKILLS_DIR}/${SKILL_NAME}"

echo "=== MCP-Server-Creator Skill Generation ==="
echo "Model:   claude-sonnet-4.6"
echo "Inputs:  ${MCPSERVER_DIR} (McpServer protos + docs)"
echo "         ${AGENT_DIR} (Agent protos + docs — for understanding mcp_server_usages)"
echo "         ${ENVIRONMENT_DIR} (Environment protos — for env_spec)"
echo "         ${SKILL_CREATOR_SKILL} (skill-creator skill — defines skill authoring format)"
echo "Output:  ${SKILLS_DIR}/${SKILL_NAME}/"
echo ""

# ---------------------------------------------------------------------------
# Draft the skill
# ---------------------------------------------------------------------------

MESSAGE=$(cat <<'EOF'
Create an mcp-server-creator skill that empowers AI assistants to create valid, production-quality Stigmer McpServer YAML files conforming to the agentic.stigmer.ai/v1 API.

The attached directories contain:
- McpServer resource (protos + docs/ with mcpserver-resource-guide.md, server-types.md, tool-approval-policies.md, capability-discovery.md, examples.md, validation-checklist.md) — the domain knowledge this skill must teach
- Agent resource (protos + docs — important because agents REFERENCE McpServers via mcp_server_usages, so understanding the consumer side is essential)
- Environment resource (protos — for understanding env_spec which McpServers use to declare required environment variables)
- The skill-creator skill — the authoritative guide for how to author well-structured skills (SKILL.md format, progressive disclosure, bundled resources, etc.). Follow its guidance on skill structure

Critical behaviors the generated skill MUST instruct agents to follow:

1. UNDERSTAND THE MCP SERVER: Before writing any YAML, gather the user's intent — what external system does the MCP server connect to, how is it started (stdio subprocess vs HTTP endpoint), what credentials does it need, and what tools should be available by default.

2. CHOOSE THE RIGHT SERVER TYPE: Guide the user between stdio (most common — for npx, python, go CLI-based MCP servers) and http (for remote/managed services). Exactly one must be specified.

3. CONFIGURE ENVIRONMENT VARIABLES: Declare all required environment variables in env_spec with accurate descriptions and correct is_secret classification. Never pre-fill secret values in the spec.

4. SET SENSIBLE DEFAULTS: Help configure default_enabled_tools (which tools are available by default) and default_tool_approvals (which tools require user approval for destructive operations). Tool names must be verified — never guessed.

5. VALIDATE THOROUGHLY: The agent must verify all validation rules (apiVersion, kind capitalization, slug format, exactly one server_type, no status fields, tool name accuracy, env var placeholder syntax) before presenting the final YAML.

6. EXPLAIN THE AGENT INTEGRATION: After creating the McpServer YAML, explain how agents reference it via mcp_server_usages — including enabled_tools restrictions and tool_approval_overrides.

Follow the skill-creator skill's guidance on skill structure: concise SKILL.md with a step-by-step workflow in the body, and reference files for detailed schemas, examples, and validation checklists. Use progressive disclosure — keep SKILL.md lean and move detailed reference material into references/ files.

This is a foundational skill for a world-class platform. The output must be precise, comprehensive, and production-ready. Write the SKILL.md so that any AI assistant using it can create flawless McpServer YAMLs on the first attempt.
EOF
)

stigmer draft skill \
  --attach "$MCPSERVER_DIR" \
  --attach "$AGENT_DIR" \
  --attach "$ENVIRONMENT_DIR" \
  --attach "$SKILL_CREATOR_SKILL" \
  --output "$SKILLS_DIR" \
  --model claude-sonnet-4.6 \
  -m "$MESSAGE"

readonly GENERATED_DIR="${SKILLS_DIR}/${SKILL_NAME}"

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: ${GENERATED_DIR}"
echo ""
echo "Next steps:"
echo "  1. Review the generated SKILL.md in ${GENERATED_DIR}"
echo "  2. Validate: python ${SKILLS_DIR}/skill-creator/scripts/quick_validate.py ${GENERATED_DIR}"
echo "  3. Package: python ${SKILLS_DIR}/skill-creator/scripts/package_skill.py ${GENERATED_DIR}"
