.PHONY: build test docker-build tidy vet lint fmt clean codegen-mcp

BINARY  := mcp-server-stigmer
CMD     := ./cmd/mcp-server-stigmer
IMAGE   := ghcr.io/stigmer/mcp-server-stigmer
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

# Build the server binary into bin/.
build:
	go build -ldflags="-X github.com/stigmer/stigmer/mcp-server/internal/server.buildVersion=$(VERSION)" -o bin/$(BINARY) $(CMD)

# Run unit tests with race detection.
test:
	go test -v -race -timeout 30s ./...

# Build Docker image.  Must be invoked from the repo root so that the build
# context includes apis/stubs/go (needed for the replace directive).
#
#   cd <repo-root> && docker build -f mcp-server/Dockerfile -t $(IMAGE):latest .
docker-build:
	docker build -f ../mcp-server/Dockerfile -t $(IMAGE):latest ..

# Tidy Go modules.
tidy:
	go mod tidy

# Run go vet on hand-written packages (generated code in gen/ is excluded
# because jsonschema-go's escaped-comma tag convention is flagged by go vet's
# structtag checker as a false positive).
vet:
	go vet $$(go list ./... | grep -v '/gen/')

# Run golangci-lint (if available).
lint:
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed, running go vet instead"; \
		go vet ./...; \
	fi

# Format all Go source files.
fmt:
	go fmt ./...

# Regenerate MCP input types for all domains.
codegen-mcp:
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/agent --output-dir=gen/agent --package=agent --target=mcp
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/mcpserver --output-dir=gen/mcpserver --package=mcpserver --target=mcp
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/workflow --output-dir=gen/workflow --package=workflow --target=mcp --expand-struct=task_config:kind:../tools/codegen/schemas/tasks

# Remove build artifacts.
clean:
	rm -rf bin/
