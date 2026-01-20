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
REPO_ROOT := $(shell git rev-parse --show-toplevel)
HOME_BIN := $(HOME)/bin

# Platform detection for embedded binaries
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
	ifeq ($(UNAME_M),arm64)
		PLATFORM := darwin_arm64
	else
		PLATFORM := darwin_amd64
	endif
else ifeq ($(UNAME_S),Linux)
	PLATFORM := linux_amd64
else
	$(error Unsupported platform: $(UNAME_S) $(UNAME_M))
endif

EMBED_DIR := embedded/binaries/$(PLATFORM)
AGENT_RUNNER_IMAGE_TAG := dev-local

.PHONY: help
help:
	@echo "Stigmer CLI Makefile"
	@echo ""
	@echo "Platform: $(PLATFORM)"
	@echo "Docker Image: ghcr.io/stigmer/agent-runner:$(AGENT_RUNNER_IMAGE_TAG)"
	@echo ""
	@echo "Available targets:"
	@echo ""
	@echo "  Development:"
	@echo "    make build                      - Build the CLI binary with Bazel"
	@echo "    make run ARGS='...'             - Build and run CLI with arguments"
	@echo "    make test                       - Run all tests"
	@echo ""
	@echo "  Installation:"
	@echo "    make install                    - Build and install CLI to GOPATH/bin"
	@echo "    make release-local              - Build all (binaries + Docker image) and install"
	@echo ""
	@echo "  Embedding (used by release-local):"
	@echo "    make embed-binaries             - Build all embedded components"
	@echo "    make embed-stigmer-server       - Build stigmer-server binary"
	@echo "    make embed-workflow-runner      - Build workflow-runner binary"
	@echo "    make build-agent-runner-image   - Build agent-runner Docker image"
	@echo ""
	@echo "  Maintenance:"
	@echo "    make clean                      - Clean build artifacts"
	@echo "    make clean-release              - Clean release artifacts only"
	@echo ""
	@echo "Usage:"
	@echo "  make release-local    # Builds everything and installs to ~/bin"

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

.PHONY: embed-stigmer-server
embed-stigmer-server:
	@echo "📦 Building stigmer-server for $(PLATFORM)..."
	@mkdir -p $(EMBED_DIR)
	@cd $(REPO_ROOT) && go build -o client-apps/cli/$(EMBED_DIR)/stigmer-server ./backend/services/stigmer-server/cmd/server
	@chmod +x $(EMBED_DIR)/stigmer-server
	@echo "✓ Embedded: $(EMBED_DIR)/stigmer-server"

.PHONY: embed-workflow-runner
embed-workflow-runner:
	@echo "📦 Building workflow-runner for $(PLATFORM)..."
	@mkdir -p $(EMBED_DIR)
	@cd $(REPO_ROOT) && go build -o client-apps/cli/$(EMBED_DIR)/workflow-runner ./backend/services/workflow-runner/cmd/worker
	@chmod +x $(EMBED_DIR)/workflow-runner
	@echo "✓ Embedded: $(EMBED_DIR)/workflow-runner"

.PHONY: build-agent-runner-image
build-agent-runner-image:
	@echo "🐳 Building agent-runner Docker image..."
	@$(MAKE) -C $(REPO_ROOT)/backend/services/agent-runner export-image-tarball VERSION=$(AGENT_RUNNER_IMAGE_TAG)
	@echo "✓ Built: ghcr.io/stigmer/agent-runner:$(AGENT_RUNNER_IMAGE_TAG)"

.PHONY: embed-binaries
embed-binaries: embed-stigmer-server embed-workflow-runner build-agent-runner-image
	@echo ""
	@echo "============================================"
	@echo "✓ All Binaries Ready for $(PLATFORM)"
	@echo "============================================"
	@ls -lh $(EMBED_DIR) 2>/dev/null || true
	@echo "Docker Image: ghcr.io/stigmer/agent-runner:$(AGENT_RUNNER_IMAGE_TAG)"
	@echo ""

.PHONY: build-cli-with-embedded
build-cli-with-embedded: embed-binaries
	@echo "🔨 Building CLI with embedded binaries..."
	@mkdir -p $(REPO_ROOT)/bin
	@cd $(REPO_ROOT)/client-apps/cli && go build -o $(REPO_ROOT)/bin/stigmer .
	@echo "✓ CLI built: bin/stigmer (with embedded binaries for $(PLATFORM))"

.PHONY: release-local
release-local: clean-release
	@echo "============================================"
	@echo "Building and Installing Stigmer Locally"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Cleaning old binaries..."
	@rm -f $(HOME_BIN)/stigmer
	@rm -f $(HOME_BIN)/stigmer-server
	@rm -f /usr/local/bin/stigmer 2>/dev/null || true
	@rm -f $(REPO_ROOT)/bin/stigmer
	@echo "✓ Old binaries removed"
	@echo ""
	@echo "Step 2: Building embedded binaries and Docker image..."
	@$(MAKE) build-cli-with-embedded
	@echo ""
	@echo "Step 3: Installing to ~/bin..."
	@mkdir -p $(HOME_BIN)
	@cp $(REPO_ROOT)/bin/stigmer $(HOME_BIN)/stigmer
	@chmod +x $(HOME_BIN)/stigmer
	@echo "✓ Installed: $(HOME_BIN)/stigmer"
	@echo ""
	@echo "============================================"
	@echo "✓ Release Complete!"
	@echo "============================================"
	@echo ""
	@if command -v stigmer >/dev/null 2>&1; then \
		echo "✓ CLI ready! Run: stigmer --help"; \
		echo "✓ Embedded binaries ready for 'stigmer server start'"; \
		echo "✓ Docker image ready: ghcr.io/stigmer/agent-runner:$(AGENT_RUNNER_IMAGE_TAG)"; \
		echo ""; \
		stigmer --version 2>/dev/null || echo "Version: development"; \
	else \
		echo "⚠️  Add ~/bin to PATH to use 'stigmer' command:"; \
		echo "   export PATH=\"\$$HOME/bin:\$$PATH\""; \
	fi
	@echo ""

.PHONY: clean-release
clean-release:
	@echo "🧹 Cleaning previous release artifacts..."
	@rm -rf embedded/binaries
	@rm -f $(REPO_ROOT)/bin/stigmer

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
	@rm -rf $(EMBED_DIR)
	@rm -f $(REPO_ROOT)/bin/stigmer
	@cd ../.. && bazel clean
	@echo "✓ Clean complete"
