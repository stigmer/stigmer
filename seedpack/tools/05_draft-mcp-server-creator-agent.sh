#!/usr/bin/env bash
# ==============================================================================
# draft_mcp_server_creator.sh - Generate the mcp-server-creator agent YAML
# ==============================================================================
#
# Uses `stigmer draft agent` to generate the mcp-server-creator agent that
# wraps the vendored mcp-server-creator skill. This follows the same pattern
# as 03_draft-skill-creator-agent.sh: we use the agent-creator agent (our own
# system agent) to create another system agent.
#
# The output goes directly to the seedpack agents/ directory, overwriting the
# existing mcp-server-creator.yaml. Use `git diff` to review changes.
#
# Inputs:
#   - Agent proto schemas + agent-resource-guide.md (for Agent YAML structure)
#   - McpServer proto schemas + docs (for understanding the McpServer resource)
#
# We do NOT attach the mcp-server-creator skill or agent-creator.yaml. The drafting
# system already has agent-creation patterns from the agent-creator skill. The agent
# we create only needs to reference the mcp-server-creator skill (kind/org/slug) —
# the full skill content is injected at runtime, not needed for drafting.
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   ./05_draft-mcp-server-creator-agent.sh
#
# Output:
#   Generated agent YAML saved directly to agents/mcp-server-creator.yaml.
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
readonly MCPSERVER_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/mcpserver"
readonly OUTPUT_DIR="${SEEDPACK_DIR}/agents"

# Verify input paths exist
for dir in "$AGENT_DIR" "$MCPSERVER_DIR"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

echo "=== MCP-Server-Creator Agent Generation ==="
echo "Model:   claude-sonnet-4.6"
echo "Inputs:  ${AGENT_DIR} (Agent protos + docs)"
echo "         ${MCPSERVER_DIR} (McpServer protos + docs)"
echo "Output:  ${OUTPUT_DIR}/mcp-server-creator.yaml"
echo ""

# ---------------------------------------------------------------------------
# Draft the agent
# ---------------------------------------------------------------------------

read -r -d '' MESSAGE <<'EOMSG' || true
Create an mcp-server-creator agent that helps users create valid, production-quality
Stigmer McpServer YAML files conforming to the agentic.stigmer.ai/v1 API.

Context about this agent:
- It is a system agent (stigmer.ai/system: "true") in the Stigmer platform
- It wraps the "mcp-server-creator" skill (kind: skill, org: local, slug: mcp-server-creator)
- It uses the "stigmer-mcp-server" MCP server to discover available resources
  (enabled tools: search, get_agent, get_mcp_server, get_skill, get_workflow)
- Its metadata.name must be "mcp-server-creator" (no -agent suffix)

The attached files include:
- The Agent proto schemas and agent-resource-guide.md for understanding the
  Agent YAML format
- The McpServer proto schemas and docs for understanding the domain

Follow the same structural patterns as sibling system agents (agent-creator,
skill-creator): same apiVersion, kind, label conventions, and mcp_server_usages
structure. The instructions should be tailored to MCP server creation.

Key behaviors the agent's instructions must cover:
1. Gather user intent about what external system the MCP server connects to,
   how it is started (stdio vs http), what credentials it needs, and what
   tools should be available by default
2. Query available resources using the Stigmer MCP server to check for
   existing MCP servers and avoid duplication
3. Construct a valid McpServer YAML applying the domain knowledge from the
   attached McpServer docs
4. Choose the correct server type (stdio for CLI-based servers, http for
   remote/hosted services) and configure it appropriately
5. Configure environment variables in env_spec with accurate descriptions
   and correct is_secret classification
6. Set sensible default_enabled_tools and default_tool_approvals, noting
   that tool names must be verified via discovery
7. Validate against format requirements before delivering output
8. After presenting the McpServer YAML, explain how agents reference it
   via mcp_server_usages

Output rules the instructions must enforce:
- Create ONLY the Agent YAML file. Do NOT create auxiliary documentation
  (README.md, SUMMARY.md, etc.)
- Valid references only: follow schema strictly per agentic.stigmer.ai/v1
- Never pre-fill secret values in env_spec
- Flag unverified tool names when discovery hasn't been run
EOMSG

stigmer draft agent \
  --attach "$AGENT_DIR" \
  --attach "$MCPSERVER_DIR" \
  --output "$OUTPUT_DIR" \
  --model claude-sonnet-4.6 \
  -m "$MESSAGE"

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: ${OUTPUT_DIR}/mcp-server-creator.yaml"
echo ""
echo "Next steps:"
echo "  1. Review changes:  git diff ${SEEDPACK_DIR}/agents/mcp-server-creator.yaml"
echo "  2. Run tests:       go test ./seedpack/ -v"
