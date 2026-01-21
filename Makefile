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

test: ## Run all tests
	@echo "============================================"
	@echo "Running All Tests"
	@echo "============================================"
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
	@echo "✓ All Tests Complete!"
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

build-agent-runner: ## Build agent-runner PyInstaller binary (for development)
	@echo "Building agent-runner binary..."
	@cd backend/services/agent-runner && $(MAKE) build-binary
	@echo "✓ Built: backend/services/agent-runner/dist/agent-runner"

install-agent-runner: build-agent-runner ## Build and install agent-runner to ~/.stigmer/bin
	@echo "Installing agent-runner to ~/.stigmer/bin..."
	@mkdir -p $(HOME)/.stigmer/bin
	@cp backend/services/agent-runner/dist/agent-runner $(HOME)/.stigmer/bin/agent-runner
	@chmod +x $(HOME)/.stigmer/bin/agent-runner
	@echo "✓ Installed: $(HOME)/.stigmer/bin/agent-runner"
	@echo ""
	@echo "Agent-runner binary ready for local testing."
	@echo "Run 'stigmer server' to use the updated binary."

release-local-full: ## Build CLI and agent-runner for complete local testing
	@echo "============================================"
	@echo "Building Complete Local Environment"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Building agent-runner binary..."
	@$(MAKE) install-agent-runner
	@echo ""
	@echo "Step 2: Building and installing CLI..."
	@$(MAKE) release-local
	@echo ""
	@echo "============================================"
	@echo "✓ Complete Local Release Ready!"
	@echo "============================================"
	@echo ""
	@echo "Components installed:"
	@echo "  • CLI: $(HOME)/bin/stigmer"
	@echo "  • Agent Runner: $(HOME)/.stigmer/bin/agent-runner"
	@echo ""
	@echo "Ready to test: stigmer server"

.DEFAULT_GOAL := help
