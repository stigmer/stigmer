#!/usr/bin/env bash
# ==============================================================================
# draft_agent_creator_agent.sh - Generate the agent-creator agent YAML
# ==============================================================================
#
# Uses `stigmer draft agent` to generate the agent-creator agent that wraps
# the agent-creator skill. This follows the same pattern as the other agent
# generation scripts: we use `stigmer draft agent` to produce a system agent
# YAML that references the corresponding skill.
#
# The output goes directly to the seedpack agents/ directory, overwriting the
# existing agent-creator.yaml. Use `git diff` to review changes.
#
# Inputs:
#   - Agent proto schemas + agent-resource-guide.md (for Agent YAML structure)
#   - Skill proto schemas (for understanding the Skill resource domain)
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   ./06_draft-agent-creator-agent.sh
#
# Output:
#   Generated agent YAML saved directly to agents/agent-creator.yaml.
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

readonly AGENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/agent"
readonly SKILL_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/skill"
readonly OUTPUT_DIR="${SEEDPACK_DIR}/agents"

# Verify input paths exist
for dir in "$AGENT_DIR" "$SKILL_DIR"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

echo "=== Agent-Creator Agent Generation ==="
echo "Model:   claude-sonnet-4.6"
echo "Inputs:  ${AGENT_DIR} (Agent protos + docs)"
echo "         ${SKILL_DIR} (Skill protos)"
echo "Output:  ${OUTPUT_DIR}/agent-creator.yaml"
echo ""

# ---------------------------------------------------------------------------
# Draft the agent
# ---------------------------------------------------------------------------

read -r -d '' MESSAGE <<'EOMSG' || true
Create an agent-creator agent that helps users create valid, production-quality
Stigmer Agent YAML files conforming to the agentic.stigmer.ai/v1 API.

Context about this agent:
- It is a system agent (stigmer.ai/system: "true") in the Stigmer platform
- It wraps the "agent-creator" skill (kind: skill, org: local, slug: agent-creator)
- It uses the "stigmer-mcp-server" MCP server to discover available resources
  (enabled tools: search, get_agent, get_mcp_server, get_skill, get_workflow)
- Its metadata.name must be "agent-creator" (no -agent suffix)

The attached files include:
- The Agent proto schemas and agent-resource-guide.md for understanding the
  Agent YAML format
- The Skill proto schemas for understanding skills that agents can reference

Follow the same structural patterns as sibling system agents (skill-creator,
mcp-server-creator): same apiVersion, kind, label conventions, and
mcp_server_usages structure. The instructions should be tailored to agent
creation.

Key behaviors the agent's instructions must cover:
1. Gather user intent about what the agent should do, what skills it needs,
   what MCP servers it should use, and what sub-agents (if any) it delegates to
2. Query available resources using the Stigmer MCP server to discover existing
   skills, agents, and MCP servers — MANDATORY before referencing any resource
3. Construct a valid Agent YAML applying the domain knowledge from the
   attached Agent proto schemas and docs
4. Configure skill_refs, mcp_server_usages, and sub_agent_refs correctly
   with valid kind/org/slug references
5. Write clear, actionable instructions that guide the agent's behavior
6. Validate against format requirements before delivering output
7. Present the Agent YAML with explanation of key design decisions

Output rules the instructions must enforce:
- Create ONLY the Agent YAML file. Do NOT create auxiliary documentation
  (README.md, SUMMARY.md, etc.)
- Valid references only: follow schema strictly per agentic.stigmer.ai/v1
- Never reference resources without first querying them via MCP server
EOMSG

stigmer draft agent \
  --attach "$AGENT_DIR" \
  --attach "$SKILL_DIR" \
  --output "$OUTPUT_DIR" \
  --model claude-sonnet-4.6 \
  -m "$MESSAGE"

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: ${OUTPUT_DIR}/agent-creator.yaml"
echo ""
echo "Next steps:"
echo "  1. Review changes:  git diff ${SEEDPACK_DIR}/agents/agent-creator.yaml"
echo "  2. Run tests:       go test ./seedpack/ -v"
