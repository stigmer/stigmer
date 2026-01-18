#!/usr/bin/env bash
# Bazel wrapper script for agent-runner
# This allows agent-runner to be launched via Bazel while using Poetry for dependency management

set -euo pipefail

# Find the actual workspace root (not the Bazel sandbox)
# Bazel sets BUILD_WORKSPACE_DIRECTORY when running with 'bazel run'
if [ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    # Running via 'bazel run' - use the workspace directory
    WORKSPACE_ROOT="${BUILD_WORKSPACE_DIRECTORY}"
else
    # Fallback: try to find workspace root from script location
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Navigate up from the script location to find the workspace root
    # Look for WORKSPACE or MODULE.bazel file
    CURRENT_DIR="${SCRIPT_DIR}"
    while [ "${CURRENT_DIR}" != "/" ]; do
        if [ -f "${CURRENT_DIR}/MODULE.bazel" ] || [ -f "${CURRENT_DIR}/WORKSPACE" ]; then
            WORKSPACE_ROOT="${CURRENT_DIR}"
            break
        fi
        CURRENT_DIR="$(dirname "${CURRENT_DIR}")"
    done
    
    if [ -z "${WORKSPACE_ROOT:-}" ]; then
        echo "Error: Could not find workspace root"
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
