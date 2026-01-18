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
	@echo "  stigmer init                              - Initialize local backend and start daemon"
	@echo "  stigmer local start                       - Start local daemon (stigmer-server + agent-runner)"
	@echo "  stigmer local stop                        - Stop local daemon"
	@echo "  stigmer local status                      - Check daemon status"
	@echo "  stigmer local restart                     - Restart local daemon"
	@echo "  stigmer backend status                    - Show current backend (local/cloud)"
	@echo "  stigmer backend set <local|cloud>         - Switch backend"
	@echo "  stigmer agent create --name X --instructions Y  - Create agent via CLI flags"
	@echo "  stigmer agent list                        - List all agents"
	@echo "  stigmer agent get <id>                    - Get agent details"
	@echo "  stigmer agent delete <id>                 - Delete agent"
	@echo "  stigmer workflow create --name X          - Create workflow via CLI flags"
	@echo "  stigmer workflow list                     - List all workflows"
	@echo "  stigmer workflow get <id>                 - Get workflow details"
	@echo "  stigmer workflow delete <id>              - Delete workflow"
	@echo "  stigmer version                           - Show version"
	@echo ""
	@echo "Future CLI Commands (not yet implemented):"
	@echo "  stigmer apply -f <file.yaml>              - Apply resources from YAML files"
	@echo "  stigmer run                               - Execute resources in current directory"
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
	@echo "  1. Initialize local backend: stigmer init"
	@echo "  2. Start daemon: stigmer local start"
	@echo "  3. Create an agent: stigmer agent create --name test --instructions 'Hello'"
	@echo "  4. List agents: stigmer agent list"

.PHONY: run
run: build
	@$(BAZEL_BIN) $(ARGS)

.PHONY: test
test:
	@echo "Running tests..."
	@cd ../.. && bazel test //client-apps/cli/...

.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	@cd ../.. && bazel clean
	@echo "✓ Clean complete"
