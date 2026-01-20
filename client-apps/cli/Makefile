# Stigmer CLI Makefile
# 
# Available commands:
#   make build          - Build the CLI binary
#   make install        - Build and install CLI to GOPATH/bin
#   make release-local  - Build, install, and verify CLI (for local testing)
#   make run            - Build and run CLI with ARGS="..."
#   make test           - Run tests
#   make clean          - Clean build artifacts
#   make help           - Show available commands

BINARY_NAME := stigmer
GOPATH_BIN := $(shell go env GOPATH)/bin
BAZEL_BIN := ../../bazel-bin/client-apps/cli/stigmer_/stigmer

.PHONY: help
help:
	@echo "Available targets:"
	@echo ""
	@echo "  Development:"
	@echo "    make build          - Build the CLI binary with Bazel"
	@echo "    make run            - Build and run CLI (usage: make run ARGS='agent list')"
	@echo "    make test           - Run all tests"
	@echo ""
	@echo "  Installation:"
	@echo "    make install        - Build and install CLI to GOPATH/bin ($(GOPATH_BIN))"
	@echo "    make release-local  - Build, install, and verify CLI (recommended for testing)"
	@echo ""
	@echo "  Maintenance:"
	@echo "    make clean          - Clean build artifacts"
	@echo ""
	@echo "Current CLI Commands (implemented):"
	@echo "  stigmer server                            - Start Stigmer server (auto-initializes)"
	@echo "  stigmer server stop                       - Stop server"
	@echo "  stigmer server status                     - Check server status"
	@echo "  stigmer server restart                    - Restart server"
	@echo "  stigmer backend status                    - Show current backend (local/cloud)"
	@echo "  stigmer backend set <local|cloud>         - Switch backend"
	@echo ""
	@echo "Future CLI Commands (planned):"
	@echo "  stigmer apply -f <file.yaml>              - Apply resources from YAML files"
	@echo "  stigmer agent execute <id> <prompt>       - Execute agent with prompt"
	@echo "  stigmer workflow execute <id> --input...  - Execute workflow"

.PHONY: build
build:
	@echo "Building stigmer CLI..."
	@cd ../.. && bazel build //client-apps/cli:stigmer
	@echo "✓ Build complete: $(BAZEL_BIN)"

.PHONY: install
install: build
	@echo "Installing stigmer CLI to $(GOPATH_BIN)..."
	@mkdir -p "$(GOPATH_BIN)"
	@cp -f "$(BAZEL_BIN)" "$(GOPATH_BIN)/$(BINARY_NAME)"
	@chmod +x "$(GOPATH_BIN)/$(BINARY_NAME)"
	@echo "✓ Installed: $(GOPATH_BIN)/$(BINARY_NAME)"
	@echo ""
	@echo "Verify installation:"
	@echo "  $(BINARY_NAME) --help"

.PHONY: release-local
release-local: clean install
	@echo ""
	@echo "============================================"
	@echo "Local Release Complete!"
	@echo "============================================"
	@echo ""
	@echo "Verifying installation..."
	@which $(BINARY_NAME) || (echo "ERROR: $(BINARY_NAME) not found in PATH. Add $(GOPATH_BIN) to your PATH" && exit 1)
	@$(BINARY_NAME) --help > /dev/null && echo "✓ CLI is working" || (echo "ERROR: CLI failed to run" && exit 1)
	@echo ""
	@echo "Installed: $$(which $(BINARY_NAME))"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Start server: stigmer server"
	@echo "  2. Open Temporal UI: http://localhost:8233"
	@echo "  3. Check status: stigmer server status"

.PHONY: run
run: build
	@"$(BAZEL_BIN)" $(ARGS)

.PHONY: test
test:
	@cd ../.. && bazel test //client-apps/cli/...

.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	@cd ../.. && bazel clean
	@echo "✓ Clean complete"
