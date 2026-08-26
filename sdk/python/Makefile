# Stigmer Python SDK - Makefile

.PHONY: help
help: ## Display this help message
	@echo "Stigmer Python SDK - Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: codegen-clients
codegen-clients: ## Generate SDK client code from service schemas
	@echo "Generating Python SDK client code..."
	@echo "  Wiping src/stigmer/_gen/ directory..."
	@rm -rf src/stigmer/_gen
	@mkdir -p src/stigmer/_gen
	@# The generator runs from TypeScript source via the repo-pinned tsx
	@# (never bare npx — oss#531).
	@cd ../.. && test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@cd ../.. && node_modules/.bin/tsx tools/codegen/src/generator/main.ts \
		--schema-dir tools/codegen/schemas \
		--output-dir sdk/python/src/stigmer/_gen \
		--target sdk-client-python

.PHONY: codegen
codegen: codegen-clients ## Run code generation pipeline
	@echo ""
	@echo "Python SDK code generation complete!"
	@echo "Generated files live in src/stigmer/_gen/"

.PHONY: codegen-verify
codegen-verify: codegen ## Generate code and verify syntax
	@echo "Verifying generated Python files..."
	@python3 -c "import ast, pathlib; \
		files = list(pathlib.Path('src/stigmer/_gen').glob('*.py')); \
		[ast.parse(f.read_text()) for f in files]; \
		print(f'  {len(files)} files passed syntax check')"
	@echo ""
	@echo "Code generation verified successfully!"

.PHONY: clean
clean: ## Clean build artifacts
	@rm -rf dist build *.egg-info src/*.egg-info

.DEFAULT_GOAL := help
