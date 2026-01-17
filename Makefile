.PHONY: help setup build test clean proto-gen lint coverage

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
