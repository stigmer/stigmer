# Stigmer Go SDK - Makefile

.PHONY: help
help: ## Display this help message
	@echo "Stigmer Go SDK - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: ## Build the SDK
	@echo "Building SDK..."
	@go build ./...

.PHONY: test
test: ## Run all tests
	@echo "Running tests..."
	@go test -v ./...

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	@echo "Running tests with coverage..."
	@go test -v -race -coverprofile=coverage.out -covermode=atomic ./...
	@go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

.PHONY: vet
vet: ## Run go vet
	@echo "Running go vet..."
	@go vet ./...

.PHONY: tidy
tidy: ## Run go mod tidy
	@echo "Tidying dependencies..."
	@go mod tidy

.PHONY: verify
verify: vet test ## Run all verification steps (vet, test)
	@echo "All verification steps passed!"

.PHONY: clean
clean: ## Clean build artifacts and test caches
	@echo "Cleaning..."
	@go clean -testcache
	@rm -f coverage.out coverage.html

.PHONY: codegen-stubs
codegen-stubs: ## Generate proto stubs inside the SDK module
	@echo "Generating proto stubs into proto/..."
	@rm -rf proto
	@mkdir -p proto
	@# Install pinned local codegen plugins so buf.gen.sdk-go.yaml has no
	@# buf.build network dependency (mirrors the apis go-stubs pipeline).
	@$(MAKE) -C ../../apis go-stubs-tools
	@cd ../../apis && buf generate --template buf.gen.sdk-go.yaml
	@if [ -d "proto/github.com" ]; then \
		mv proto/github.com/stigmer/stigmer/sdk/go/v3/proto/* proto/ 2>/dev/null || true; \
		rm -rf proto/github.com; \
	fi
	@# Scrub @internal comment sections: proto/ is a subpackage of the
	@# published SDK module, so protoc-copied internal notes would render on
	@# pkg.go.dev and in IDE hovers (oss#497). This generation path bypasses
	@# apis/scripts/gen-stubs.sh, hence its own scrub hook. stubscrub runs
	@# from TypeScript source via the repo-pinned tsx (never bare npx —
	@# oss#531), so the root npm install must exist.
	@cd ../.. && test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@cd ../.. && node_modules/.bin/tsx tools/codegen/src/stubscrub/main.ts sdk/go/proto
	@echo "Proto stubs generated in proto/"

.PHONY: codegen-schemas
codegen-schemas: ## Generate JSON schemas from proto files (Stage 1)
	@echo "Stage 1: Generating JSON schemas from protos..."
	@# The protoc-gen-stigmer-schema buf plugin runs from TypeScript source
	@# via the repo-pinned tsx (never bare npx — oss#531); buf compiles the
	@# protos and owns all writes (clean: true wipes stale schemas).
	@cd ../.. && test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@cd ../../apis && buf generate --template buf.gen.schema.yaml

.PHONY: codegen-clients
codegen-clients: ## Generate SDK client code from service schemas (Stage 2)
	@echo "Stage 2: Generating SDK client code..."
	@echo "  Wiping internal/gen/ directory..."
	@rm -rf internal/gen
	@mkdir -p internal/gen
	@# The generator runs from TypeScript source via the repo-pinned tsx
	@# (never bare npx — oss#531). It pipes generated Go through gofmt, so
	@# the Go toolchain must be on PATH (it already is — the SDK build
	@# follows), and it reads proto metadata from @stigmer/protos, which
	@# must be built first (incremental; a no-op when fresh). A bare CI
	@# checkout has no dist/ — skipping this fails module resolution.
	@cd ../.. && test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@cd ../.. && npm run build -w @stigmer/protos --silent
	@cd ../.. && node_modules/.bin/tsx tools/codegen/src/generator/main.ts \
		--schema-dir tools/codegen/schemas \
		--output-dir sdk/go/internal/gen \
		--target sdk-client

.PHONY: codegen
codegen: codegen-stubs codegen-schemas codegen-clients ## Run full code generation pipeline
	@echo ""
	@echo "Full SDK code generation complete!"
	@echo "Generated files live in proto/ and internal/gen/"

.PHONY: codegen-verify
codegen-verify: codegen build test ## Generate code, build, and test to verify
	@echo ""
	@echo "Code generation verified successfully!"

.DEFAULT_GOAL := help
