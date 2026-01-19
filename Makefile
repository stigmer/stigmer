# Default bump type for releases (can be overridden: make protos-release bump=minor)
bump ?= patch

.PHONY: help setup build build-backend test clean protos protos-release lint coverage release-local install dev

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Install dependencies and tools
	@echo "Installing Go dependencies..."
	go mod download
	@echo "Installing Python dependencies..."
	cd sdk/python && pip install -e .[dev]
	@echo "Setup complete!"

build: protos ## Build the Stigmer CLI
	@echo "Building Stigmer CLI..."
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "Build complete: bin/stigmer"

build-backend: protos ## Build all backend services
	@echo "Building all backend services..."
	@echo ""
	@echo "1/4 Building stigmer-server..."
	go build -o bin/stigmer-server ./backend/services/stigmer-server/cmd/server
	@echo "✓ Built: bin/stigmer-server"
	@echo ""
	@echo "2/4 Building workflow-runner worker..."
	go build -o bin/workflow-runner ./backend/services/workflow-runner/cmd/worker
	@echo "✓ Built: bin/workflow-runner"
	@echo ""
	@echo "3/4 Building workflow-runner gRPC server..."
	go build -o bin/workflow-runner-grpc ./backend/services/workflow-runner/cmd/grpc-server
	@echo "✓ Built: bin/workflow-runner-grpc"
	@echo ""
	@echo "4/4 Type checking agent-runner (Python)..."
	@cd backend/services/agent-runner && \
		poetry install --no-interaction --quiet && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✓ Type checking passed: agent-runner"
	@echo ""
	@echo "============================================"
	@echo "✓ All backend services built successfully!"
	@echo "============================================"

test: ## Run all tests
	@echo "Running Go tests..."
	go test -v -race -timeout 30s ./...
	@echo "Running Python SDK tests..."
	cd sdk/python && pytest
	@echo "Running Agent Runner tests..."
	cd backend/services/agent-runner && poetry install --no-interaction --quiet && poetry run pytest

coverage: ## Generate test coverage report
	@echo "Generating coverage report..."
	go test -v -race -coverprofile=coverage.txt -covermode=atomic ./...
	go tool cover -html=coverage.txt -o coverage.html
	@echo "Coverage report: coverage.html"

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
	@echo "Running Go linters..."
	go vet ./...
	gofmt -s -w .
	@echo "Running proto linters..."
	$(MAKE) -C apis lint
	@echo "Linting complete!"

clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	rm -rf coverage.txt coverage.html
	rm -rf sdk/python/build sdk/python/dist sdk/python/*.egg-info
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
	@rm -f $(HOME)/bin/stigmer-server
	@rm -f /usr/local/bin/stigmer 2>/dev/null || true
	@rm -f bin/stigmer
	@rm -f bin/stigmer-server
	@echo "✓ Old binaries removed"
	@echo ""
	@echo "Step 2: Building fresh binaries..."
	@mkdir -p bin
	@cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "✓ CLI built: bin/stigmer"
	@go build -o bin/stigmer-server ./backend/services/stigmer-server/cmd/server
	@echo "✓ Server built: bin/stigmer-server"
	@echo ""
	@echo "Step 3: Installing to ~/bin..."
	@mkdir -p $(HOME)/bin
	@cp bin/stigmer $(HOME)/bin/stigmer
	@chmod +x $(HOME)/bin/stigmer
	@echo "✓ Installed: $(HOME)/bin/stigmer"
	@cp bin/stigmer-server $(HOME)/bin/stigmer-server
	@chmod +x $(HOME)/bin/stigmer-server
	@echo "✓ Installed: $(HOME)/bin/stigmer-server"
	@echo ""
	@echo "============================================"
	@echo "✓ Release Complete!"
	@echo "============================================"
	@echo ""
	@if command -v stigmer >/dev/null 2>&1; then \
		echo "✓ CLI ready! Run: stigmer --help"; \
		echo "✓ Server ready for 'stigmer local'"; \
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

.DEFAULT_GOAL := help
