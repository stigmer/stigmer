#!/usr/bin/env bash
# ==============================================================================
# draft_agent_creator.sh - Generate the agent-creator skill
# ==============================================================================
#
# Uses `stigmer draft skill` to generate a skill that teaches AI assistants
# to create valid Stigmer Agent YAML files.
#
# Inputs are the canonical proto directories (agent, skill, mcpserver) plus
# the agent-resource-guide.md documentation -- no copies, no duplicates.
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   ./02_draft-agent-creator-skill.sh
#
# Output:
#   Generated skill saved to ../skills/agent-creator/
#   (relative to this script's location in the seedpack tools/ directory)
#
# ==============================================================================

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SEEDPACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd "${SEEDPACK_DIR}/../../../../.." && pwd)"

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

readonly SKILL_NAME="agent-creator"
readonly SKILLS_DIR="${SEEDPACK_DIR}/skills"

readonly AGENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/agent"
readonly SKILL_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/skill"
readonly MCPSERVER_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/mcpserver"

# Verify input directories exist
for dir in "$AGENT_DIR" "$SKILL_DIR" "$MCPSERVER_DIR"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

# Clean only the target skill directory, preserving siblings (e.g. skill-creator).
# The CLI creates a subdirectory named after the artifact inside --output, so we
# point --output at skills/ and let the CLI produce skills/agent-creator/.
rm -rf "${SKILLS_DIR}/${SKILL_NAME}"

echo "=== Agent-Creator Skill Generation ==="
echo "Model:   claude-opus-4-6"
echo "Inputs:  ${AGENT_DIR} (protos + docs)"
echo "         ${SKILL_DIR} (protos)"
echo "         ${MCPSERVER_DIR} (protos)"
echo "Output:  ${SKILLS_DIR}/${SKILL_NAME}/"
echo ""

# ---------------------------------------------------------------------------
# Draft the skill
# ---------------------------------------------------------------------------

MESSAGE=$(cat <<'EOF'
Create an agent-creator skill that empowers AI assistants to create valid, production-quality Stigmer Agent YAML files conforming to the agentic.stigmer.ai/v1 API.

The attached directories contain the canonical protobuf schemas for Agent, Skill, and McpServer resources, plus a comprehensive agent-resource-guide.md that explains the Agent resource from the perspective of someone creating agents.

Critical behaviors the generated skill MUST instruct agents to follow:

1. QUERY AVAILABLE RESOURCES: Before suggesting mcp_server_usages or skill_refs, the agent MUST query available MCP servers and skills using the Stigmer MCP server tools (search, get_mcp_server, get_skill). Never guess or hallucinate resource references -- use real data from the platform.

2. ASK QUESTIONS: If the user's intent is unclear, or if a skill or MCP server seems required but doesn't exist on the platform, the agent MUST pause and ask the user before proceeding. Never silently assume.

3. VALIDATE THOROUGHLY: The agent must verify all validation rules (naming conventions, minimum instruction length, sub-agent tool subsets, unique MCP slugs) before presenting the final YAML.

This is a foundational skill for a world-class platform. The output must be precise, comprehensive, and production-ready. Write the SKILL.md so that any AI assistant using it can create flawless Agent YAMLs on the first attempt.
EOF
)

stigmer draft skill \
  --attach "$AGENT_DIR" \
  --attach "$SKILL_DIR" \
  --attach "$MCPSERVER_DIR" \
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
