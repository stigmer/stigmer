# Stigmer TypeScript CLI - Makefile

.PHONY: help
help: ## Display this help message
	@echo "Stigmer TypeScript CLI - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@npx tsc --noEmit

.PHONY: build
build: ## Build the CLI
	@npx tsc -p tsconfig.build.json

.PHONY: test
test: ## Run the test suite
	@npx vitest run

.PHONY: clean
clean: ## Clean build artifacts
	@rm -rf dist tsconfig.build.tsbuildinfo

.DEFAULT_GOAL := help
