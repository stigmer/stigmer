# Stigmer Java SDK - Makefile

SDK_GEN_DIR := src/main/java/ai/stigmer/sdk/gen

.PHONY: help
help: ## Display this help message
	@echo "Stigmer Java SDK - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: ## Compile the SDK
	@echo "Building SDK..."
	@mvn compile -q

.PHONY: test
test: ## Run all tests
	@echo "Running tests..."
	@mvn test -q

.PHONY: verify
verify: build test ## Run all verification steps (compile, test)
	@echo "All verification steps passed!"

.PHONY: clean
clean: ## Clean build artifacts
	@echo "Cleaning..."
	@mvn clean -q

.PHONY: codegen-clients
codegen-clients: ## Generate SDK client code from service schemas (Stage 2)
	@echo "Generating Java SDK client code..."
	@echo "  Wiping $(SDK_GEN_DIR)/ directory..."
	@rm -rf $(SDK_GEN_DIR)
	@mkdir -p $(SDK_GEN_DIR)
	@# The generator runs from TypeScript source via the repo-pinned tsx
	@# (never bare npx — oss#531).
	@cd ../.. && test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@cd ../.. && node_modules/.bin/tsx tools/codegen/src/generator/main.ts \
		--schema-dir tools/codegen/schemas \
		--output-dir sdk/java/$(SDK_GEN_DIR) \
		--target sdk-client-java

.PHONY: codegen
codegen: codegen-clients ## Run code generation pipeline
	@echo ""
	@echo "Java SDK code generation complete!"
	@echo "Generated files live in $(SDK_GEN_DIR)/"

.PHONY: codegen-verify
codegen-verify: codegen build test ## Generate code, build, and test to verify
	@echo ""
	@echo "Code generation verified successfully!"

.DEFAULT_GOAL := help
