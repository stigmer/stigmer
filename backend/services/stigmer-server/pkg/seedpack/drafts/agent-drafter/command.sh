#!/bin/bash
# =============================================================================
# Agent-Drafter Skill Generation Script
# =============================================================================
# This script reproduces the stigmer draft skill command used to generate
# the agent-drafter skill. It can be re-run to regenerate the skill.
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running (see below)
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   1. Start the stigmer server in a separate terminal:
#      export STIGMER_LLM_PROVIDER=anthropic
#      export ANTHROPIC_API_KEY=<your-api-key>
#      stigmer server
#
#   2. Run this script:
#      ./command.sh
#
# Note: The model is specified via --model flag in the draft skill command,
# so STIGMER_LLM_MODEL environment variable is not needed for the server.
#
# =============================================================================

set -euo pipefail

# Navigate to script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Validate prerequisites
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

# Configuration
INPUTS_DIR="inputs"
OUTPUTS_DIR="outputs"

# Ensure outputs directory exists and is empty
rm -rf "$OUTPUTS_DIR"
mkdir -p "$OUTPUTS_DIR"

echo "=== Agent-Drafter Skill Generation ==="
echo "Provider: anthropic"
echo "Model: claude-sonnet-4.5"
echo "Inputs directory: $INPUTS_DIR"
echo "Outputs directory: $OUTPUTS_DIR"
echo ""

# List input files
echo "Input files:"
ls -la "$INPUTS_DIR"
echo ""

# Run the draft skill command
echo "Running stigmer draft skill..."
echo ""

stigmer draft skill \
  --attach "$INPUTS_DIR/agent-api.proto" \
  --attach "$INPUTS_DIR/agent-spec.proto" \
  --attach "$INPUTS_DIR/managing-agents.md" \
  --attach "$INPUTS_DIR/example-agent.yaml" \
  --attach "$INPUTS_DIR/requirements.md" \
  --output "$OUTPUTS_DIR" \
  --model claude-sonnet-4.5 \
  -m "Create an agent-drafter skill that helps AI assistants create valid Stigmer Agent YAML files. Use the attached proto files for the exact schema, the managing-agents.md for CLI usage examples, and the example-agent.yaml as a reference implementation."

echo ""
echo "=== Generation Complete ==="
echo "Output saved to: $OUTPUTS_DIR"
echo ""
echo "Next steps:"
echo "  1. Review the generated SKILL.md"
echo "  2. Validate: python ../../skills/skill-creator/scripts/quick_validate.py $OUTPUTS_DIR"
echo "  3. If valid, move to skills: cp -r $OUTPUTS_DIR/* ../../skills/agent-drafter/"
echo "  4. Package: python ../../skills/skill-creator/scripts/package_skill.py ../../skills/agent-drafter"
