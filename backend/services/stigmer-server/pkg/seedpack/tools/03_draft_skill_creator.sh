#!/usr/bin/env bash
# ==============================================================================
# draft_skill_creator.sh - Generate the skill-creator agent YAML
# ==============================================================================
#
# Uses `stigmer draft agent` to generate the skill-creator agent that wraps
# the vendored skill-creator skill. This is a dogfooding exercise: we use the
# agent-creator agent (our own system agent) to create another system agent.
#
# The output goes to a review directory. The operator must review the generated
# YAML and manually copy it into the seedpack agents/ directory.
#
# Inputs:
#   - Agent proto schemas + agent-resource-guide.md (for Agent YAML structure)
#   - Skill proto schemas (for understanding the Skill resource)
#   - The existing skill-creator skill (so the agent knows what to reference)
#   - The existing agent-creator agent YAML (as a sibling example)
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   ./03_draft_skill_creator.sh
#
# Output:
#   Generated agent YAML saved to a review directory under the seedpack tools/
#   directory. The operator must review before promoting to agents/.
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

readonly AGENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/agent"
readonly SKILL_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/skill"
readonly SKILL_CREATOR_SKILL="${SEEDPACK_DIR}/skills/skill-creator"
readonly AGENT_CREATOR_YAML="${SEEDPACK_DIR}/agents/agent-creator.yaml"
readonly REVIEW_DIR="${SCRIPT_DIR}/_review/skill-creator"

# Verify input paths exist
for dir in "$AGENT_DIR" "$SKILL_DIR" "$SKILL_CREATOR_SKILL"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

if [ ! -f "$AGENT_CREATOR_YAML" ]; then
    echo "ERROR: Agent YAML not found: $AGENT_CREATOR_YAML"
    exit 1
fi

# Prepare review directory
rm -rf "$REVIEW_DIR"
mkdir -p "$REVIEW_DIR"

echo "=== Skill-Creator Agent Generation ==="
echo "Model:   claude-sonnet-4.6"
echo "Inputs:  ${AGENT_DIR} (Agent protos + docs)"
echo "         ${SKILL_DIR} (Skill protos)"
echo "         ${SKILL_CREATOR_SKILL} (skill-creator skill)"
echo "         ${AGENT_CREATOR_YAML} (sibling agent example)"
echo "Output:  ${REVIEW_DIR}/"
echo ""

# ---------------------------------------------------------------------------
# Draft the agent
# ---------------------------------------------------------------------------

MESSAGE=$(cat <<'EOF'
Create a skill-creator agent that helps users create well-structured SKILL.md
packages following the Agent Skills format.

Context about this agent:
- It is a system agent (stigmer.ai/system: "true") in the Stigmer platform
- It wraps the "skill-creator" skill (kind: skill, org: local, slug: skill-creator)
- It uses the "stigmer-mcp-server" MCP server to discover available resources
  (enabled tools: search, get_agent, get_mcp_server, get_skill, get_workflow)
- Its metadata.name must be "skill-creator" (no -agent suffix)

The attached files include:
- The Agent proto schemas and agent-resource-guide.md for understanding the
  Agent YAML format
- The Skill proto schemas for understanding the Skill resource
- The skill-creator skill directory (so you know what skill to reference)
- The agent-creator.yaml as a sibling example of the expected agent structure

The generated agent should follow the exact same structural patterns as the
agent-creator.yaml example: same apiVersion, kind, label conventions, and
mcp_server_usages structure. The instructions should be tailored to skill
creation (not agent creation).

Key behaviors the agent's instructions must cover:
1. Gather user intent about what domain/task the skill addresses
2. Apply the skill-creator skill guidance from the system prompt
3. Generate complete skill files (SKILL.md + bundled resources)
4. Validate against format requirements before delivering output
5. Provide a clear summary of what was created

Output rules the instructions must enforce:
- Create ONLY the skill directory with SKILL.md and necessary bundled resources
- Do NOT create auxiliary documentation (README.md, SUMMARY.md, etc.)
- Use relative paths only within skill files
EOF
)

stigmer draft agent \
  --attach "$AGENT_DIR" \
  --attach "$SKILL_DIR" \
  --attach "$SKILL_CREATOR_SKILL" \
  --attach "$AGENT_CREATOR_YAML" \
  --output "$REVIEW_DIR" \
  --model claude-sonnet-4.6 \
  -m "$MESSAGE"

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: ${REVIEW_DIR}"
echo ""
echo "Next steps:"
echo "  1. Review the generated YAML in ${REVIEW_DIR}"
echo "  2. Compare with the current agent:"
echo "       diff ${SEEDPACK_DIR}/agents/skill-creator.yaml ${REVIEW_DIR}/*.yaml"
echo "  3. If satisfied, copy to the seedpack:"
echo "       cp ${REVIEW_DIR}/*.yaml ${SEEDPACK_DIR}/agents/skill-creator.yaml"
echo "  4. Run tests to verify:"
echo "       go test ./backend/services/stigmer-server/pkg/seedpack/ -v"
