# Stigmer Agent SDK Go - Makefile

# Default bump type for releases (can be overridden: make release bump=minor)
bump ?= patch

.PHONY: help
help: ## Display this help message
	@echo "Stigmer Agent SDK Go - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: ## Build the SDK
	@echo "Building SDK..."
	@go build $(shell go list ./... | grep -v /examples)

.PHONY: test
test: ## Run all tests
	@echo "Running tests..."
	@go test -v -race -cover ./...

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	@echo "Running tests with coverage..."
	@go test -v -race -coverprofile=coverage.out -covermode=atomic ./...
	@go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

.PHONY: test-short
test-short: ## Run short tests only
	@echo "Running short tests..."
	@go test -v -short ./...

.PHONY: lint
lint: ## Run golangci-lint
	@echo "Running linters..."
	@golangci-lint run ./...

.PHONY: fmt
fmt: ## Format code with gofmt
	@echo "Formatting code..."
	@go fmt ./...

.PHONY: vet
vet: ## Run go vet
	@echo "Running go vet..."
	@go vet ./...

.PHONY: tidy
tidy: ## Run go mod tidy
	@echo "Tidying dependencies..."
	@go mod tidy

.PHONY: verify
verify: fmt vet lint test ## Run all verification steps (fmt, vet, lint, test)
	@echo "All verification steps passed!"

.PHONY: clean
clean: ## Clean build artifacts and test caches
	@echo "Cleaning..."
	@go clean -testcache
	@rm -f coverage.out coverage.html

.PHONY: install-tools
install-tools: ## Install development tools
	@echo "Installing development tools..."
	@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@echo "Tools installed successfully!"

.PHONY: proto-check
proto-check: ## Verify proto stubs are available
	@echo "Checking proto stubs..."
	@test -d ../../apis/stubs/go || (echo "ERROR: Proto stubs not found at ../../apis/stubs/go" && exit 1)
	@echo "Proto stubs found!"

.PHONY: examples
examples: ## Run all examples
	@echo "Running examples..."
	@for example in examples/*.go; do \
		echo "Running $$example..."; \
		go run $$example || exit 1; \
	done
	@echo "All examples completed!"

.PHONY: update-deps
update-deps: ## Update buf proto dependencies to latest
	@echo "Updating buf proto dependencies..."
	@go get -u buf.build/gen/go/leftbin/stigmer/protocolbuffers/go
	@go get -u buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go
	@go mod tidy
	@echo "✓ Dependencies updated successfully!"
	@echo ""
	@echo "Updated versions:"
	@grep "buf.build/gen/go" ../go.mod

.PHONY: release
release: ## Create and push a release tag (usage: make release [bump=patch|minor|major])
	@echo "🏷️  Auto-incrementing version tag..."
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
	echo ""; \
	echo "✓ Release tag $$NEW_TAG created and pushed successfully!"; \
	echo ""; \
	echo "View release: https://github.com/leftbin/stigmer-sdk/releases/tag/$$NEW_TAG"

.DEFAULT_GOAL := help
