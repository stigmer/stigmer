# Stigmer TypeScript MCP Server - Makefile

.PHONY: help
help: ## Display this help message
	@echo "Stigmer TypeScript MCP Server - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: codegen-apply
codegen-apply: ## Generate apply-tool zod schemas + toProto bridges from proto schemas
	@echo "Generating TypeScript MCP apply-input modules..."
	@echo "  Wiping src/gen/ directory..."
	@rm -rf src/gen
	@mkdir -p src/gen
	@cd ../.. && go run ./tools/codegen/generator/ \
		--comprehensive \
		--schema-dir tools/codegen/schemas \
		--output-dir mcp-server-ts/src/gen \
		--target mcp-ts

.PHONY: codegen
codegen: codegen-apply ## Run code generation pipeline
	@echo ""
	@echo "TypeScript MCP code generation complete!"
	@echo "Generated files live in src/gen/"

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@npx tsc --noEmit

.PHONY: build
build: ## Build the MCP server
	@npx tsc -p tsconfig.build.json

.PHONY: test
test: ## Run the test suite
	@npx vitest run

.PHONY: clean
clean: ## Clean build artifacts
	@rm -rf dist tsconfig.build.tsbuildinfo

.DEFAULT_GOAL := help
