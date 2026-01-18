# Default bump type for releases (can be overridden: make protos-release bump=minor)
bump ?= patch

.PHONY: help setup build test clean proto-gen protos protos-release lint coverage

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Install dependencies and tools
	@echo "Installing Go dependencies..."
	go mod download
	@echo "Installing buf..."
	go install github.com/bufbuild/buf/cmd/buf@latest
	@echo "Installing protoc plugins..."
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	@echo "Installing Python dependencies..."
	cd sdk/python && pip install -e .[dev]
	@echo "Setup complete!"

build: proto-gen ## Build the Stigmer CLI
	@echo "Building Stigmer CLI..."
	go build -o bin/stigmer ./cmd/stigmer
	@echo "Build complete: bin/stigmer"

test: ## Run all tests
	@echo "Running Go tests..."
	go test -v -race -timeout 30s ./...
	@echo "Running Python tests..."
	cd sdk/python && pytest

coverage: ## Generate test coverage report
	@echo "Generating coverage report..."
	go test -v -race -coverprofile=coverage.txt -covermode=atomic ./...
	go tool cover -html=coverage.txt -o coverage.html
	@echo "Coverage report: coverage.html"

proto-gen: ## Generate code from protobuf definitions
	@echo "Generating protobuf code..."
	buf generate
	@echo "Protobuf generation complete!"

protos: proto-gen ## Generate protocol buffer stubs (alias for proto-gen)

protos-release: ## Release protos to Buf and create Git tag (usage: make protos-release [bump=patch|minor|major])
	@echo "============================================"
	@echo "Releasing Protos with Version Tagging"
	@echo "============================================"
	@echo ""
	@echo "Step 1: Publishing protos to Buf..."
	@echo "--------------------------------------------"
	@cd proto && buf push
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

lint: ## Run linters
	@echo "Running Go linters..."
	go vet ./...
	gofmt -s -w .
	@echo "Running buf lint..."
	buf lint
	@echo "Linting complete!"

clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	rm -rf coverage.txt coverage.html
	rm -rf sdk/python/build sdk/python/dist sdk/python/*.egg-info
	@echo "Clean complete!"

install: build ## Install Stigmer CLI to system
	@echo "Installing stigmer to /usr/local/bin..."
	cp bin/stigmer /usr/local/bin/stigmer
	@echo "Installation complete!"

dev: ## Run Stigmer in development mode
	go run ./cmd/stigmer

.DEFAULT_GOAL := help
