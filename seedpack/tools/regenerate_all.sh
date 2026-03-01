#!/usr/bin/env bash
# ==============================================================================
# regenerate_all.sh - Regenerate all seedpack content in dependency order
# ==============================================================================
#
# Runs all draft and vendor scripts in the correct order. Each numbered script
# depends on the output of earlier ones:
#
#   01  Vendor upstream skills (standalone — brings in skill-creator source)
#   02  Draft agent-creator skill       (uses proto schemas only)
#   03  Draft agent-creator agent       (uses proto schemas only)
#   04  Draft mcp-server-creator skill  (uses proto schemas only)
#   05  Draft mcp-server-creator agent  (uses proto schemas only)
#
# NOTE: The skill-creator agent (agents/skill-creator.yaml) is hand-maintained
# and NOT regenerated. It contains runtime-specific conventions that AI
# generation cannot reliably produce.
#
# The draft scripts (02-05) are independent of each other — they only read
# proto schemas from apis/. However, the numbering is preserved for clarity.
#
# Prerequisites:
#   - stigmer CLI built and available in PATH
#   - stigmer server running with an LLM provider configured
#   - ANTHROPIC_API_KEY set in environment
#   - git, jq (for vendor script)
#
# Usage:
#   ./regenerate_all.sh           # run all scripts
#   ./regenerate_all.sh --skip-vendor   # skip vendoring, draft only
#
# ==============================================================================

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

SKIP_VENDOR=false
for arg in "$@"; do
    case "$arg" in
        --skip-vendor) SKIP_VENDOR=true ;;
        -h|--help)
            echo "Usage: $0 [--skip-vendor]"
            echo ""
            echo "  --skip-vendor   Skip the vendoring step (01), only run drafts"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Run scripts in order
# ---------------------------------------------------------------------------

run_script() {
    local script="$1"
    local name
    name="$(basename "$script")"
    echo ""
    echo "================================================================="
    echo "  Running: ${name}"
    echo "================================================================="
    echo ""
    bash "$script"
    echo ""
    echo "  ✓ ${name} completed"
    echo ""
}

if [ "$SKIP_VENDOR" = false ]; then
    run_script "${SCRIPT_DIR}/01_vendor_skill.sh"
fi

run_script "${SCRIPT_DIR}/02_draft-agent-creator-skill.sh"
run_script "${SCRIPT_DIR}/03_draft-agent-creator-agent.sh"
run_script "${SCRIPT_DIR}/04_draft-mcp-server-creator-skill.sh"
run_script "${SCRIPT_DIR}/05_draft-mcp-server-creator-agent.sh"

echo ""
echo "================================================================="
echo "  All seedpack content regenerated successfully"
echo "================================================================="
echo ""
echo "Next steps:"
echo "  1. Review changes:  git diff seedpack/"
echo "  2. Run tests:       go test ./seedpack/ -v"
echo "  3. Commit:          git add seedpack/ && git commit"
