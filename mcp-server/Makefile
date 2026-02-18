.PHONY: build test docker-build tidy vet lint fmt clean

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

# Run go vet on all packages.
vet:
	go vet ./...

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

# Remove build artifacts.
clean:
	rm -rf bin/
