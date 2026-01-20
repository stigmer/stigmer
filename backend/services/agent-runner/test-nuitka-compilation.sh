#!/usr/bin/env bash
# Quick test: Can Nuitka compile agent-runner with all dependencies?
# This validates the proposed architecture before full implementation.

set -euo pipefail

echo "🧪 Testing Nuitka compilation feasibility..."
echo ""

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    echo "❌ Error: Must run from backend/services/agent-runner directory"
    exit 1
fi

# Check Poetry is available
if ! command -v poetry &> /dev/null; then
    echo "❌ Error: Poetry not found. Install with: pip install poetry"
    exit 1
fi

echo "📦 Installing dependencies..."
poetry install --no-root

echo ""
echo "🔧 Installing Nuitka and optimizers..."
poetry run pip install nuitka ordered-set zstandard

echo ""
echo "🔨 Attempting compilation (this may take 5-10 minutes)..."
echo ""

# Attempt compilation with verbose output
poetry run python -m nuitka \
    --standalone \
    --onefile \
    --output-dir=dist-test \
    --output-filename=agent-runner-test \
    --include-package=temporalio \
    --include-package=worker \
    --include-package=grpc_client \
    --python-flag=no_site \
    --python-flag=no_warnings \
    --show-progress \
    --show-modules \
    main.py

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Compilation successful!"
    echo ""
    echo "📊 Binary information:"
    ls -lh dist-test/agent-runner-test
    file dist-test/agent-runner-test
    echo ""
    echo "🧪 Testing binary (--help should work even without Python):"
    echo ""
    ./dist-test/agent-runner-test --help || echo "Note: --help might not be implemented"
    echo ""
    echo "✅ Nuitka compilation is FEASIBLE for agent-runner"
    echo ""
    echo "Next steps:"
    echo "1. Add Makefile targets for production builds"
    echo "2. Test with full environment variables"
    echo "3. Build for all platforms (darwin-arm64, linux-amd64, etc.)"
    echo ""
else
    echo ""
    echo "❌ Compilation failed"
    echo ""
    echo "This means:"
    echo "- Nuitka might not be suitable (try PyInstaller as alternative)"
    echo "- OR dependencies need special handling (add more --include-package flags)"
    echo ""
    echo "Check the error messages above for details"
    exit 1
fi
