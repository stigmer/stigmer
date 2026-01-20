#!/usr/bin/env bash
# Launcher script for agent-runner
# Supports multiple execution modes: production (extracted binaries), Bazel, and development

set -euo pipefail

# Determine workspace root with explicit precedence order:
# 1. STIGMER_AGENT_RUNNER_WORKSPACE (production mode - set by stigmer daemon)
# 2. BUILD_WORKSPACE_DIRECTORY (Bazel mode - set by 'bazel run')
# 3. Directory tree walking (development mode - find MODULE.bazel/WORKSPACE)

if [ -n "${STIGMER_AGENT_RUNNER_WORKSPACE:-}" ]; then
    # Production mode: daemon explicitly sets the workspace location
    WORKSPACE_ROOT="${STIGMER_AGENT_RUNNER_WORKSPACE}"
    
elif [ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    # Bazel mode: running via 'bazel run'
    WORKSPACE_ROOT="${BUILD_WORKSPACE_DIRECTORY}"
    
else
    # Development mode: find workspace root by walking up directory tree
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Look for MODULE.bazel or WORKSPACE file
    CURRENT_DIR="${SCRIPT_DIR}"
    while [ "${CURRENT_DIR}" != "/" ]; do
        if [ -f "${CURRENT_DIR}/MODULE.bazel" ] || [ -f "${CURRENT_DIR}/WORKSPACE" ]; then
            WORKSPACE_ROOT="${CURRENT_DIR}"
            break
        fi
        CURRENT_DIR="$(dirname "${CURRENT_DIR}")"
    done
    
    if [ -z "${WORKSPACE_ROOT:-}" ]; then
        echo "Error: Could not determine workspace root"
        echo ""
        echo "This script supports three execution modes:"
        echo "  1. Production: Set STIGMER_AGENT_RUNNER_WORKSPACE=/path/to/extracted/agent-runner"
        echo "  2. Bazel:      Run with 'bazel run //backend/services/agent-runner'"
        echo "  3. Development: Run from within stigmer source tree (has MODULE.bazel)"
        echo ""
        echo "Current directory: ${SCRIPT_DIR}"
        exit 1
    fi
fi

# Service directory in the actual source tree
SERVICE_DIR="${WORKSPACE_ROOT}/backend/services/agent-runner"

# Verify pyproject.toml exists
if [ ! -f "${SERVICE_DIR}/pyproject.toml" ]; then
    echo "Error: pyproject.toml not found in ${SERVICE_DIR}"
    exit 1
fi

# Change to service directory where pyproject.toml lives
cd "${SERVICE_DIR}"

# Note: .env file is loaded automatically by main.py via python-dotenv
# No need to source it here - Python's load_dotenv() handles it properly

# Run with Poetry (which manages the virtualenv and dependencies)
exec poetry run python main.py "$@"
