# Default bump type for releases (can be overridden: make protos-release bump=minor)
bump ?= patch

.PHONY: help setup build build-backend test clean protos protos-release lint coverage release-local install dev

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Install dependencies and tools
	@echo "Installing Go dependencies for all modules..."
	@cd apis/stubs/go && go mod download
	@cd backend/libs/go && go mod download
	@cd backend/services/stigmer-server && go mod download
	@cd backend/services/workflow-runner && go mod download
	@cd client-apps/cli && go mod download
	@cd sdk/go && go mod download
	@echo "Installing Agent Runner dependencies..."
	cd backend/services/agent-runner && poetry install
	@echo "Setup complete!"

build: protos ## Build the Stigmer CLI
	@echo "Building Stigmer CLI..."
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "Build complete: bin/stigmer"

build-backend: protos ## Build all backend services
	@echo "Building all backend services..."
	@echo ""
	@echo "Note: stigmer-server and workflow-runner are now part of the CLI (BusyBox pattern)"
	@echo "      Use 'stigmer internal-server' and 'stigmer internal-workflow-runner' instead"
	@echo ""
	@echo "1/2 Building workflow-runner gRPC server..."
	go build -o bin/workflow-runner-grpc ./backend/services/workflow-runner/cmd/grpc-server
	@echo "✓ Built: bin/workflow-runner-grpc"
	@echo ""
	@echo "2/2 Type checking agent-runner (Python)..."
	@cd backend/services/agent-runner && \
		poetry install --no-interaction --quiet && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✓ Type checking passed: agent-runner"
	@echo ""
	@echo "============================================"
	@echo "✓ All backend services processed!"
	@echo "============================================"

test: ## Run unit tests (no infrastructure required, runs in CI)
	@echo "============================================"
	@echo "Running Unit Tests"
	@echo "============================================"
	@echo ""
	@echo "Note: E2E tests are excluded (use 'make test-e2e' to run them)"
	@echo ""
	@echo "1/7 Running API Stubs Tests..."
	@echo "--------------------------------------------"
	cd apis/stubs/go && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "2/7 Running Backend Libs Tests..."
	@echo "--------------------------------------------"
	cd backend/libs/go && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "3/7 Running Stigmer Server Tests..."
	@echo "--------------------------------------------"
	cd backend/services/stigmer-server && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "4/7 Running Workflow Runner Tests..."
	@echo "--------------------------------------------"
	cd backend/services/workflow-runner && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "5/7 Running CLI Tests..."
	@echo "--------------------------------------------"
	cd client-apps/cli && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "6/7 Running SDK Go Tests..."
	@echo "--------------------------------------------"
	cd sdk/go && go test -v -race -timeout 30s ./...
	@echo ""
	@echo "7/7 Running Agent Runner Tests (Python)..."
	@echo "--------------------------------------------"
	cd backend/services/agent-runner && poetry install --no-interaction --quiet && poetry run pytest
	@echo ""
	@echo "============================================"
	@echo "✓ Unit Tests Complete!"
	@echo "============================================"

test-all-go: ## Run all Go workspace module tests
	@echo "Running all Go workspace tests..."
	@cd apis/stubs/go && go test -v -race -timeout 30s ./...
	@cd backend/libs/go && go test -v -race -timeout 30s ./...
	@cd backend/services/stigmer-server && go test -v -race -timeout 30s ./...
	@cd backend/services/workflow-runner && go test -v -race -timeout 30s ./...
	@cd client-apps/cli && go test -v -race -timeout 30s ./...
	@cd sdk/go && go test -v -race -timeout 30s ./...

test-sdk: ## Run SDK Go tests only
	@echo "Running SDK Go tests..."
	cd sdk/go && go test -v -race -timeout 30s ./...

test-workflow-runner: ## Run workflow-runner tests only
	@echo "Running workflow-runner tests..."
	cd backend/services/workflow-runner && go test -v -race -timeout 30s ./...

test-agent-runner: ## Run agent-runner tests only (Python)
	@echo "Running agent-runner tests..."
	cd backend/services/agent-runner && poetry install --no-interaction --quiet && poetry run pytest

test-e2e: ## Run E2E integration tests (requires: stigmer server + ollama running)
	@echo "============================================"
	@echo "Running E2E Integration Tests"
	@echo "============================================"
	@echo ""
	@echo "Prerequisites (checked by tests):"
	@echo "  1. Stigmer server: stigmer server"
	@echo "  2. Ollama: ollama serve"
	@echo ""
	cd test/e2e && go test -v -tags=e2e -timeout 60s ./...
	@echo ""
	@echo "============================================"
	@echo "✓ E2E Tests Complete!"
	@echo "============================================"

test-all: test test-e2e ## Run ALL tests (unit + E2E, requires infrastructure)

coverage: ## Generate test coverage report
	@echo "Generating coverage report for all Go modules..."
	@mkdir -p coverage
	@cd apis/stubs/go && go test -v -race -coverprofile=../../../coverage/apis.txt -covermode=atomic ./...
	@cd backend/libs/go && go test -v -race -coverprofile=../../../coverage/libs.txt -covermode=atomic ./...
	@cd backend/services/stigmer-server && go test -v -race -coverprofile=../../../coverage/server.txt -covermode=atomic ./...
	@cd backend/services/workflow-runner && go test -v -race -coverprofile=../../../coverage/workflow-runner.txt -covermode=atomic ./...
	@cd client-apps/cli && go test -v -race -coverprofile=../../coverage/cli.txt -covermode=atomic ./...
	@cd sdk/go && go test -v -race -coverprofile=../../coverage/sdk.txt -covermode=atomic ./...
	@echo "Coverage reports generated in coverage/ directory"

protos: ## Generate protocol buffer stubs
	$(MAKE) -C apis build

protos-release: ## Release protos to Buf and create Git tag (usage: make protos-release [bump=patch|minor|major])
	@echo "============================================"
	@echo "Releasing Protos with Version Tagging"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Publishing protos to Buf..."
	@echo "--------------------------------------------"
	$(MAKE) -C apis release
	@echo ""
	@echo "✓ Protos released successfully to buf.build/stigmer/stigmer"
	@echo ""
	@echo "Step 2: Creating Git version tag..."
	@echo "--------------------------------------------"
	@# Get the latest tag, default to v0.0.0 if none exists
	@LATEST_TAG=$$(git tag -l "v*" | sort -V | tail -n1); \
	if [ -z "$$LATEST_TAG" ]; then \
		LATEST_TAG="v0.0.0"; \
		echo "No existing tags found. Starting from $$LATEST_TAG"; \
	else \
		echo "Latest tag: $$LATEST_TAG"; \
	fi; \
	\
	VERSION=$$(echo $$LATEST_TAG | sed 's/^v//'); \
	MAJOR=$$(echo $$VERSION | cut -d. -f1); \
	MINOR=$$(echo $$VERSION | cut -d. -f2); \
	PATCH=$$(echo $$VERSION | cut -d. -f3); \
	\
	echo "Bump type: $(bump)"; \
	echo ""; \
	\
	case $(bump) in \
		major) \
			MAJOR=$$((MAJOR + 1)); \
			MINOR=0; \
			PATCH=0; \
			;; \
		minor) \
			MINOR=$$((MINOR + 1)); \
			PATCH=0; \
			;; \
		patch) \
			PATCH=$$((PATCH + 1)); \
			;; \
		*) \
			echo "ERROR: Invalid bump type '$(bump)'. Use: patch, minor, or major"; \
			exit 1; \
			;; \
	esac; \
	\
	NEW_TAG="v$$MAJOR.$$MINOR.$$PATCH"; \
	echo "New tag: $$NEW_TAG"; \
	echo ""; \
	\
	if git rev-parse "$$NEW_TAG" >/dev/null 2>&1; then \
		echo "ERROR: Tag $$NEW_TAG already exists"; \
		exit 1; \
	fi; \
	\
	echo "Creating release tag: $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "Release $$NEW_TAG"; \
	git push origin "$$NEW_TAG"; \
	echo ""
	@echo "============================================"
	@echo "✓ Proto Release Complete!"
	@echo "============================================"
	@echo ""
	@echo "Summary:"
	@echo "  • Protos: Published to buf.build/stigmer/stigmer"
	@LATEST_TAG=$$(git tag -l "v*" | sort -V | tail -n1); \
	echo "  • Git Tag: $$LATEST_TAG"
	@echo ""

release: ## Create and push release tag (usage: make release [bump=patch|minor|major])
	@echo "============================================"
	@echo "Creating Stigmer CLI Release Tag"
	@echo "============================================"
	@echo ""
	@# Get the latest tag, default to v0.0.0 if none exists
	@LATEST_TAG=$$(git tag -l "v*" | sort -V | tail -n1); \
	if [ -z "$$LATEST_TAG" ]; then \
		LATEST_TAG="v0.0.0"; \
		echo "No existing tags found. Starting from $$LATEST_TAG"; \
	else \
		echo "Latest tag: $$LATEST_TAG"; \
	fi; \
	\
	VERSION=$$(echo $$LATEST_TAG | sed 's/^v//'); \
	MAJOR=$$(echo $$VERSION | cut -d. -f1); \
	MINOR=$$(echo $$VERSION | cut -d. -f2); \
	PATCH=$$(echo $$VERSION | cut -d. -f3); \
	\
	echo "Bump type: $(bump)"; \
	echo ""; \
	\
	case $(bump) in \
		major) \
			MAJOR=$$((MAJOR + 1)); \
			MINOR=0; \
			PATCH=0; \
			;; \
		minor) \
			MINOR=$$((MINOR + 1)); \
			PATCH=0; \
			;; \
		patch) \
			PATCH=$$((PATCH + 1)); \
			;; \
		*) \
			echo "ERROR: Invalid bump type '$(bump)'. Use: patch, minor, or major"; \
			exit 1; \
			;; \
	esac; \
	\
	NEW_TAG="v$$MAJOR.$$MINOR.$$PATCH"; \
	echo "New tag: $$NEW_TAG"; \
	echo ""; \
	\
	if git rev-parse "$$NEW_TAG" >/dev/null 2>&1; then \
		echo "ERROR: Tag $$NEW_TAG already exists"; \
		exit 1; \
	fi; \
	\
	echo "Creating release tag: $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "Release $$NEW_TAG"; \
	git push origin "$$NEW_TAG"; \
	echo ""
	@echo "============================================"
	@echo "✓ Release Tag Created!"
	@echo "============================================"
	@echo ""
	@echo "Summary:"
	@LATEST_TAG=$$(git tag -l "v*" | sort -V | tail -n1); \
	echo "  • Git Tag: $$LATEST_TAG pushed to origin"
	@echo "  • GitHub Actions will now build and publish release"
	@echo "  • Release URL: https://github.com/stigmer/stigmer/releases/tag/$$LATEST_TAG"
	@echo ""

lint: ## Run linters
	@echo "Running Go linters on all modules..."
	@cd apis/stubs/go && go vet ./...
	@cd backend/libs/go && go vet ./...
	@cd backend/services/stigmer-server && go vet ./...
	@cd backend/services/workflow-runner && go vet ./...
	@cd client-apps/cli && go vet ./...
	@cd sdk/go && go vet ./...
	@echo "Running gofmt..."
	gofmt -s -w .
	@echo "Running proto linters..."
	$(MAKE) -C apis lint
	@echo "Linting complete!"

clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	rm -rf coverage/
	rm -rf coverage.txt coverage.html
	rm -rf backend/services/workflow-runner/bin/
	$(MAKE) -C apis clean
	@echo "Clean complete!"

install: build ## Install Stigmer CLI to system
	@echo "Installing stigmer to /usr/local/bin..."
	sudo cp bin/stigmer /usr/local/bin/stigmer
	sudo chmod +x /usr/local/bin/stigmer
	@echo "Installation complete!"

release-local: ## Build and install CLI for local testing (fast rebuild without protos)
	@echo "============================================"
	@echo "Building and Installing Stigmer Locally"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Removing old binaries..."
	@rm -f $(HOME)/bin/stigmer
	@rm -f /usr/local/bin/stigmer 2>/dev/null || true
	@rm -f bin/stigmer
	@echo "✓ Old binaries removed"
	@echo ""
	@echo "Step 2: Building fresh binaries..."
	@mkdir -p bin
	@cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "✓ CLI built: bin/stigmer"
	@echo ""
	@echo "Step 3: Installing to ~/bin..."
	@mkdir -p $(HOME)/bin
	@cp bin/stigmer $(HOME)/bin/stigmer
	@chmod +x $(HOME)/bin/stigmer
	@echo "✓ Installed: $(HOME)/bin/stigmer"
	@echo ""
	@echo "============================================"
	@echo "✓ Release Complete!"
	@echo "============================================"
	@echo ""
	@if command -v stigmer >/dev/null 2>&1; then \
		echo "✓ CLI ready! Run: stigmer --help"; \
		echo ""; \
		stigmer --version 2>/dev/null || echo "Version: development"; \
	else \
		echo "⚠️  Add ~/bin to PATH to use 'stigmer' command:"; \
		echo "   export PATH=\"\$$HOME/bin:\$$PATH\""; \
	fi
	@echo ""
	@echo "Note: Run 'make protos' first if you need to regenerate proto stubs"

dev: ## Run Stigmer in development mode
	cd client-apps/cli && go run .

build-agent-runner-image: ## Build agent-runner Docker image (for development)
	@echo "============================================"
	@echo "Building Agent-Runner Docker Image"
	@echo "============================================"
	@echo ""
	@echo "Building agent-runner from local source code..."
	@cd backend/services/agent-runner && docker build -f Dockerfile -t stigmer-agent-runner:local -t ghcr.io/stigmer/agent-runner:latest ../../..
	@echo ""
	@echo "✓ Docker image built with tags:"
	@echo "  - stigmer-agent-runner:local"
	@echo "  - ghcr.io/stigmer/agent-runner:latest"
	@echo ""
	@echo "Verifying images..."
	@docker images | grep -E "stigmer-agent-runner|ghcr.io/stigmer/agent-runner"
	@echo ""

release-local-full: ## Build CLI and agent-runner Docker image for complete local testing
	@echo "============================================"
	@echo "Building Complete Local Environment"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Stopping old agent-runner container (if running)..."
	@if docker ps -a --format '{{.Names}}' | grep -q '^stigmer-agent-runner$$'; then \
		echo "Stopping and removing old agent-runner container..."; \
		docker stop stigmer-agent-runner 2>/dev/null || true; \
		docker rm stigmer-agent-runner 2>/dev/null || true; \
		echo "✓ Old container removed"; \
	else \
		echo "✓ No old container to remove"; \
	fi
	@echo ""
	@echo "Step 2: Building agent-runner Docker image..."
	@$(MAKE) build-agent-runner-image
	@echo ""
	@echo "Step 3: Building and installing CLI..."
	@$(MAKE) release-local
	@echo ""
	@echo "============================================"
	@echo "✓ Complete Local Release Ready!"
	@echo "============================================"
	@echo ""
	@echo "Components installed:"
	@echo "  • CLI: $(HOME)/bin/stigmer"
	@echo "  • Agent Runner Docker images:"
	@echo "    - stigmer-agent-runner:local"
	@echo "    - ghcr.io/stigmer/agent-runner:latest (from local source)"
	@echo ""
	@echo "The stigmer server will now use the locally built agent-runner image."
	@echo ""
	@echo "Ready to test: stigmer server"

# ==================== Sandbox Targets ====================

sandbox-build-basic: ## Build basic sandbox Docker image (~300MB, lightweight)
	@echo "============================================"
	@echo "Building Basic Sandbox Image"
	@echo "============================================"
	@echo ""
	@echo "Building stigmer-sandbox-basic:local..."
	@cd backend/services/agent-runner/sandbox && \
		docker build -f Dockerfile.sandbox.basic -t stigmer-sandbox-basic:local .
	@echo ""
	@echo "✓ Built: stigmer-sandbox-basic:local (~300MB)"
	@echo ""
	@echo "Verifying image..."
	@docker images stigmer-sandbox-basic:local
	@echo ""
	@echo "Test with:"
	@echo "  docker run --rm -it stigmer-sandbox-basic:local bash"
	@echo ""

sandbox-build-full: ## Build full sandbox Docker image (~1-2GB, all tools)
	@echo "============================================"
	@echo "Building Full Sandbox Image"
	@echo "============================================"
	@echo ""
	@echo "⚠️  This will take 10-15 minutes and create a ~1-2GB image"
	@echo ""
	@echo "Building stigmer-sandbox-full:local..."
	@cd backend/services/agent-runner/sandbox && \
		docker build -f Dockerfile.sandbox.full -t stigmer-sandbox-full:local .
	@echo ""
	@echo "✓ Built: stigmer-sandbox-full:local (~1-2GB)"
	@echo ""
	@echo "Verifying image..."
	@docker images stigmer-sandbox-full:local
	@echo ""
	@echo "Test with:"
	@echo "  docker run --rm -it stigmer-sandbox-full:local bash"
	@echo ""

sandbox-test: ## Test sandbox images (verify tools work)
	@echo "============================================"
	@echo "Testing Sandbox Images"
	@echo "============================================"
	@echo ""
	@if docker images -q stigmer-sandbox-basic:local 2>/dev/null | grep -q .; then \
		echo "Testing basic sandbox..."; \
		docker run --rm stigmer-sandbox-basic:local python --version; \
		docker run --rm stigmer-sandbox-basic:local node --version; \
		docker run --rm stigmer-sandbox-basic:local git --version; \
		echo "✓ Basic sandbox tests passed"; \
	else \
		echo "⚠️  Basic sandbox not built. Run: make sandbox-build-basic"; \
	fi
	@echo ""
	@if docker images -q stigmer-sandbox-full:local 2>/dev/null | grep -q .; then \
		echo "Testing full sandbox..."; \
		docker run --rm stigmer-sandbox-full:local aws --version; \
		docker run --rm stigmer-sandbox-full:local kubectl version --client; \
		docker run --rm stigmer-sandbox-full:local terraform version; \
		echo "✓ Full sandbox tests passed"; \
	else \
		echo "⚠️  Full sandbox not built. Run: make sandbox-build-full"; \
	fi
	@echo ""
	@echo "============================================"
	@echo "✓ Sandbox Tests Complete!"
	@echo "============================================"

sandbox-clean: ## Remove sandbox Docker images
	@echo "Removing sandbox images..."
	@docker rmi stigmer-sandbox-basic:local 2>/dev/null || echo "Basic sandbox not found"
	@docker rmi stigmer-sandbox-full:local 2>/dev/null || echo "Full sandbox not found"
	@echo "✓ Sandbox images removed"

test-local-mode: ## Test agent-runner in local execution mode
	@echo "============================================"
	@echo "Testing Local Execution Mode"
	@echo "============================================"
	@echo ""
	@echo "Setting STIGMER_EXECUTION_MODE=local..."
	@cd backend/services/agent-runner && \
		STIGMER_EXECUTION_MODE=local poetry run python -c "from worker.config import Config; c = Config.load_from_env(); print(f'✓ Execution mode: {c.execution_mode.value}')"
	@echo ""
	@echo "✓ Local mode ready"
	@echo ""
	@echo "Start server with:"
	@echo "  export STIGMER_EXECUTION_MODE=local"
	@echo "  stigmer server start"
	@echo ""

test-sandbox-mode: sandbox-build-basic ## Test agent-runner in sandbox execution mode
	@echo "============================================"
	@echo "Testing Sandbox Execution Mode"
	@echo "============================================"
	@echo ""
	@echo "Setting STIGMER_EXECUTION_MODE=sandbox..."
	@cd backend/services/agent-runner && \
		STIGMER_EXECUTION_MODE=sandbox \
		STIGMER_SANDBOX_IMAGE=stigmer-sandbox-basic:local \
		poetry run python -c "from worker.config import Config; c = Config.load_from_env(); print(f'✓ Execution mode: {c.execution_mode.value}'); print(f'✓ Sandbox image: {c.sandbox_image}')"
	@echo ""
	@echo "✓ Sandbox mode ready"
	@echo ""
	@echo "Start server with:"
	@echo "  export STIGMER_EXECUTION_MODE=sandbox"
	@echo "  export STIGMER_SANDBOX_IMAGE=stigmer-sandbox-basic:local"
	@echo "  stigmer server start"
	@echo ""

dev-full: release-local-full sandbox-build-basic ## Build complete dev environment (CLI + agent-runner + sandbox)
	@echo ""
	@echo "============================================"
	@echo "✓ Full Development Environment Ready!"
	@echo "============================================"
	@echo ""
	@echo "Components installed:"
	@echo "  • CLI: $(HOME)/bin/stigmer"
	@echo "  • Agent Runner: stigmer-agent-runner:local"
	@echo "  • Basic Sandbox: stigmer-sandbox-basic:local"
	@echo ""
	@echo "Usage:"
	@echo ""
	@echo "  Local mode (default, fast):"
	@echo "    stigmer server start"
	@echo ""
	@echo "  Sandbox mode (isolated):"
	@echo "    export STIGMER_EXECUTION_MODE=sandbox"
	@echo "    export STIGMER_SANDBOX_IMAGE=stigmer-sandbox-basic:local"
	@echo "    stigmer server start"
	@echo ""

.DEFAULT_GOAL := help
