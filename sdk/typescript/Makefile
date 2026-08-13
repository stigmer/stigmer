# Stigmer TypeScript SDK - Makefile

.PHONY: help
help: ## Display this help message
	@echo "Stigmer TypeScript SDK - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: codegen-clients
codegen-clients: ## Generate SDK client code from service schemas
	@echo "Generating TypeScript SDK client code..."
	@echo "  Wiping src/gen/ directory..."
	@rm -rf src/gen
	@mkdir -p src/gen
	@cd ../.. && go run ./tools/codegen/generator/ \
		--schema-dir tools/codegen/schemas \
		--output-dir sdk/typescript/src/gen \
		--target sdk-client-ts

.PHONY: codegen
codegen: codegen-clients ## Run code generation pipeline
	@echo ""
	@echo "TypeScript SDK code generation complete!"
	@echo "Generated files live in src/gen/"

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@npx tsc --noEmit

.PHONY: build
build: ## Build the SDK
	@npx tsc -p tsconfig.build.json

.PHONY: clean
clean: ## Clean build artifacts
	@rm -rf dist tsconfig.build.tsbuildinfo

.DEFAULT_GOAL := help
