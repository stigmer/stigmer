SHELL := /bin/bash

.PHONY: deps dev build start lint typecheck clean preview \
        lint-copy lint-performance lint-website check

PORT ?= 3000

# Install dependencies
deps:
	yarn install

# Start development server with hot reload
dev: deps
	yarn dev --port $(PORT)

# Alias for dev
run: dev

# Production build (generates static site in out/)
build: deps
	yarn build

# Start production server (requires build first)
start:
	yarn start

# Run ESLint
lint:
	yarn lint

# Run TypeScript type checking
typecheck:
	yarn typecheck

# Remove build artifacts
clean:
	rm -rf .next out node_modules

# Preview the static build locally
preview: build
	npx serve out -l $(PORT)

# ---------------------------------------------------------------------------
# Website content lints (from site/standards/ JSON files)
# ---------------------------------------------------------------------------

# Check copy against copy-guidelines.json (banned phrases, terminology, passive voice)
lint-copy:
	yarn lint:copy

# Check build output against performance-budget.json (requires 'make build' first)
lint-performance: build
	bash scripts/lint-performance.sh

# Run all fast content lints (no build required)
lint-website: lint-copy

# Run all checks: ESLint + TypeScript + website content lints
check: lint typecheck lint-website
