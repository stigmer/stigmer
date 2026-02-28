#!/usr/bin/env bash
# ==============================================================================
# draft_agent_creator.sh - Generate the agent-creator skill
# ==============================================================================
#
# Uses `stigmer draft skill` to generate a skill that teaches AI assistants
# to create valid Stigmer Agent YAML files.
#
# The stigmer repository is provided as the workspace so the agent can freely
# explore _changelog/, apis/, and docs/ during generation. Key inputs are also
# explicitly attached as spotlight context:
#   - apis/ai/stigmer/agentic/agent    (proto schemas + docs — primary source of truth)
#   - apis/ai/stigmer/agentic/skill    (proto schemas)
#   - apis/ai/stigmer/agentic/mcpserver (proto schemas)
#   - docs/product/what-is-agent.md    (authoritative conceptual doc)
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
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

readonly SKILL_NAME="agent-creator"
readonly SKILLS_DIR="${SEEDPACK_DIR}/skills"

readonly AGENT_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/agent"
readonly SKILL_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/skill"
readonly MCPSERVER_DIR="${REPO_ROOT}/apis/ai/stigmer/agentic/mcpserver"
readonly WHAT_IS_AGENT_DOC="${REPO_ROOT}/docs/product/what-is-agent.md"

# Verify spotlight input directories and files exist
for dir in "$AGENT_DIR" "$SKILL_DIR" "$MCPSERVER_DIR"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory not found: $dir"
        exit 1
    fi
done

if [ ! -f "$WHAT_IS_AGENT_DOC" ]; then
    echo "ERROR: File not found: $WHAT_IS_AGENT_DOC"
    exit 1
fi

# Clean only the target skill directory, preserving siblings (e.g. skill-creator).
# The CLI creates a subdirectory named after the artifact inside --output, so we
# point --output at skills/ and let the CLI produce skills/agent-creator/.
rm -rf "${SKILLS_DIR}/${SKILL_NAME}"

echo "=== Agent-Creator Skill Generation ==="
echo "Workspace: ${REPO_ROOT}"
echo "Inputs:    ${AGENT_DIR} (protos + docs)"
echo "           ${SKILL_DIR} (protos)"
echo "           ${MCPSERVER_DIR} (protos)"
echo "           ${WHAT_IS_AGENT_DOC}"
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
Create an agent-creator skill that empowers AI assistants to produce valid,
production-quality Stigmer Agent YAML files conforming to the
agentic.stigmer.ai/v1 API.

You are operating inside the stigmer repository. Use this workspace access
throughout the task:

  - Explore _changelog/ to understand how the Agent, Skill, and MCP server
    resources have evolved. Focus on recent entries (2026-02 and 2026-03) that
    touch agent authoring, workspace support, or MCP server integration.

  - Treat the attached proto schemas (Agent, Skill, McpServer) as the canonical
    source of truth for every field, validation rule, and enum value. Do not
    rely on prose documentation alone -- derive your understanding from the
    protos and verify against the attached what-is-agent.md doc.

  - Do NOT read, reference, or be influenced by any content already present in
    seedpack/skills/agent-creator/. You are regenerating this skill from scratch.
    Ignore whatever exists there.

The generated SKILL.md MUST instruct agents using this skill to:

1. DISCOVER AVAILABLE RESOURCES: Before writing any mcp_server_usages or
   skill_refs, the agent MUST use the Stigmer MCP server tools -- specifically
   the search, get_mcp_server, and get_skill tools -- to query what actually
   exists on the platform. The Stigmer MCP server is connected at runtime; use
   it to discover real slugs. Never guess or hallucinate resource references.

2. ASK BEFORE ASSUMING: If the stated intent is unclear, or if a required skill
   or MCP server does not exist on the platform, the agent MUST pause and ask
   before proceeding. Never silently fill in placeholders.

3. VALIDATE BEFORE PRESENTING: Before showing the final YAML, the agent must
   verify all validation rules derived from the proto schemas: naming
   conventions, minimum instruction length, sub-agent tool subsets (sub-agents
   may only use tools the parent explicitly grants), unique MCP server slugs
   within a single agent, and correct enum string values.

This is a foundational skill for a world-class platform. Write the SKILL.md so
that any AI assistant using it can create flawless Agent YAMLs on the first
attempt.
EOF

stigmer draft skill \
  --workspace "$REPO_ROOT" \
  --attach "$AGENT_DIR" \
  --attach "$SKILL_DIR" \
  --attach "$MCPSERVER_DIR" \
  --attach "$WHAT_IS_AGENT_DOC" \
  --output "$SKILLS_DIR" \
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
