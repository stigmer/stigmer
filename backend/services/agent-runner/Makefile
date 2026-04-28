# Agent Runner Makefile
#
# The agent-runner is packaged via the Go CLI's pythonrt module, not
# PyInstaller. See client-apps/cli/internal/cli/pythonrt/ for details.
#
# Dev-loop targets live in the repo-root Makefile under AGENT_RUNNER_DIR.
# This file provides convenience targets local to the service directory.

repo_root := $(shell git rev-parse --show-toplevel)

.PHONY: clean help

clean:
	@echo "Cleaning build artifacts..."
	rm -rf build/ dist/ __pycache__/ .mypy_cache/ .pytest_cache/ .ruff_cache/
	@echo "Done"

help:
	@echo "Agent Runner - Local Targets"
	@echo ""
	@echo "  clean       Remove build/lint/test caches"
	@echo ""
	@echo "Dev-loop commands (run from repo root):"
	@echo "  make setup  Install dependencies via Poetry"
	@echo "  make test   Run pytest suite"
	@echo "  make lint   Run ruff + mypy"
	@echo "  make fix    Auto-fix lint issues"
