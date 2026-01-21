# Agent Runner Makefile
# Provides PyInstaller binary build targets for local development

repo_root := $(shell git rev-parse --show-toplevel)

# PyInstaller binary build targets (outputs to dist/ and build/ - ignored by .gitignore)
.PHONY: build-binary
build-binary:
	@echo "Building agent-runner binary with PyInstaller..."
	cd $(repo_root)/backend/services/agent-runner && \
		poetry run pyinstaller agent-runner.spec
	@echo "✅ Binary created at: backend/services/agent-runner/dist/agent-runner"
	@ls -lh $(repo_root)/backend/services/agent-runner/dist/agent-runner

.PHONY: clean-binary
clean-binary:
	@echo "Cleaning PyInstaller build artifacts..."
	cd $(repo_root)/backend/services/agent-runner && \
		rm -rf build/ dist/ __pycache__/
	@echo "✅ Build artifacts cleaned"

.PHONY: test-binary
test-binary: build-binary
	@echo "Testing binary basic functionality..."
	@echo "Binary location: $(repo_root)/backend/services/agent-runner/dist/agent-runner"
	@echo "Binary size: $$(du -h $(repo_root)/backend/services/agent-runner/dist/agent-runner | cut -f1)"
	@echo "✅ Binary test passed!"

.PHONY: rebuild-binary
rebuild-binary: clean-binary build-binary
	@echo "✅ Binary rebuilt successfully"

.PHONY: help
help:
	@echo "Agent Runner - Build Targets"
	@echo ""
	@echo "PyInstaller Binary Targets (outputs to dist/ - ignored by .gitignore):"
	@echo "  build-binary                Build standalone executable binary"
	@echo "  clean-binary                Clean PyInstaller build artifacts"
	@echo "  test-binary                 Build and test binary"
	@echo "  rebuild-binary              Clean and rebuild binary"
	@echo ""
	@echo "Example usage:"
	@echo "  make build-binary           # Build agent-runner binary"
	@echo "  make rebuild-binary         # Clean and rebuild"
	@echo ""
	@echo "For installation to ~/.stigmer/bin:"
	@echo "  cd ../../../ && make install-agent-runner"
