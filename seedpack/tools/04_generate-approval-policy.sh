#!/usr/bin/env bash
# ==============================================================================
# 04_generate-approval-policy.sh
# ==============================================================================
#
# Applies the mcp-server-stigmer McpServer YAML (triggering auto-discovery of
# tools and resources), then uses `stigmer draft mcp-server` to generate
# default_tool_approvals based on the discovered capabilities.
#
# Scope: This script operates EXCLUSIVELY on mcp-server-stigmer.
# It does not query or reference any other MCP server.
#
# The mcp-server-creator agent queries the backend for the
# mcp-server-stigmer discovered tools and determines which operations
# need human approval based on the nature of each tool. The agent writes
# the updated YAML directly to seedpack/mcp-servers/mcp-server-stigmer.yaml.
#
# Prerequisites:
#   - stigmer CLI in PATH
#   - seedpack/mcp-servers/mcp-server-stigmer.yaml exists
#   - STIGMER_API_KEY configured for discovery to connect to the server
#
# Usage:
#   ./tools/04_generate-approval-policy.sh
#
# ==============================================================================

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SEEDPACK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd "${SEEDPACK_DIR}/.." && pwd)"
readonly MCP_SERVER_YAML="${SEEDPACK_DIR}/mcp-servers/mcp-server-stigmer.yaml"

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

if ! command -v stigmer &>/dev/null; then
    echo "ERROR: stigmer CLI not found in PATH"
    echo "Build it with: make -C client-apps/cli install"
    exit 1
fi

if [ ! -f "$MCP_SERVER_YAML" ]; then
    echo "ERROR: McpServer YAML not found: ${MCP_SERVER_YAML}"
    exit 1
fi

# ---------------------------------------------------------------------------
# Apply the McpServer (triggers auto-discovery)
# ---------------------------------------------------------------------------

echo "=== Applying McpServer YAML ==="
echo "File: ${MCP_SERVER_YAML}"
echo ""

stigmer apply -f "$MCP_SERVER_YAML"

# ---------------------------------------------------------------------------
# Generate approval policies from discovered capabilities
# ---------------------------------------------------------------------------

echo ""
echo "=== Generating Approval Policies for mcp-server-stigmer ==="
echo ""

readonly _MSG_FILE="$(mktemp)"
trap 'rm -f "${_MSG_FILE}"' EXIT

cat > "${_MSG_FILE}" <<'PROMPT'
Generate an updated mcp-server-stigmer McpServer YAML with default_tool_approvals.

IMPORTANT: Only look at the MCP server named "mcp-server-stigmer".
Do NOT query, reference, or include details from any other MCP server.
The only MCP server relevant to this task is mcp-server-stigmer —
ignore everything else.

If the discovered tools or resources for mcp-server-stigmer cannot be found
(e.g. the server has not been discovered yet, the backend returns no results,
or the query fails for any reason), do NOT attempt to find the tools by any
other means — do not search the workspace, do not guess tool names, do not
look at other MCP servers' data. Simply reply that you could not find the
discovered capabilities for mcp-server-stigmer and therefore cannot generate
the approval policy.

Steps:
1. Retrieve the discovered tools and resources for the mcp-server-stigmer
   MCP server from the Stigmer backend.
2. Classify each tool as read-only (safe) or mutating/destructive (needs approval).
   Mutating operations include create, update, delete, destroy, apply, lock,
   unlock, trigger, approve, cancel, upsert, and any action that changes state.
3. For every mutating or destructive tool, add an entry under
   spec.default_tool_approvals with:
     - tool_name: the exact tool name from the discovered capabilities
     - message: a clear, human-readable sentence describing the action and
       referencing the relevant arguments using {{args.<field>}} placeholders
       so reviewers understand what will happen before they approve.
4. Group the approval entries by domain (e.g. Agent Lifecycle, Skill Management,
   Workflow Management, MCP Server Configuration, etc.) with YAML comments
   for readability.
5. Preserve the existing apiVersion, kind, metadata, and spec fields
   (description, tags, stdio, env_spec) from the current
   seedpack/mcp-servers/mcp-server-stigmer.yaml.
   Replace only the default_tool_approvals section.
6. Do NOT include the status section in the output.

Write the resulting YAML to seedpack/mcp-servers/mcp-server-stigmer.yaml in the stigmer workspace.
PROMPT

stigmer draft mcp-server \
    --workspace "$REPO_ROOT" \
    -m "$(cat "${_MSG_FILE}")"

echo ""
echo "=== Generation Complete ==="
echo "Output: ${MCP_SERVER_YAML}"
echo ""
echo "Next steps:"
echo "  1. Review the updated McpServer YAML with approval policies"
echo "  2. Apply: stigmer apply -f seedpack/mcp-servers/mcp-server-stigmer.yaml"
