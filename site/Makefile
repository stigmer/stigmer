SHELL := /bin/bash

.PHONY: deps dev build start lint typecheck clean preview generate-narration copy-narration validate-demos test-demos

PORT ?= 3000

# Install dependencies (immutable installs disabled because file: workspace
# dependencies produce environment-dependent content hashes)
deps:
	YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install
	@# Self-heal a known hoisting hazard: @stigmer/react needs lowlight@3
	@# (createLowlight), while react-syntax-highlighter pulls lowlight@1. On an
	@# incremental install over a stale tree, v1 can win the top-level slot and
	@# leave v3 unmaterialized, which crashes every /docs demo at import time.
	@# If the hoisted lowlight is not v3, force one clean reinstall to reconcile.
	@if ! grep -q '"version": "3' node_modules/lowlight/package.json 2>/dev/null; then \
		echo "==> Repairing node_modules (hoisting lowlight@3 for @stigmer/react)"; \
		rm -rf node_modules .yarn/install-state.gz; \
		YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install; \
	fi

# Start development server with hot reload
dev: deps
	rm -rf .next
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

# Generate narration audio from scenario step definitions (co-located output)
generate-narration: deps
	yarn generate-narration

# Copy co-located narration audio to public/demos/ for Next.js static serving
copy-narration: deps
	yarn copy-narration

# Validate demo scenarios for token compliance, interaction coverage, and manifest alignment
validate-demos: deps
	yarn validate-demos

# Run Playwright demo e2e tests (starts dev server automatically via playwright.config.ts)
# Requires Playwright browsers: npx playwright install
test-demos: deps
	yarn test:demos

# Remove build artifacts
clean:
	rm -rf .next out node_modules .source

# Preview the static build locally
preview: build
	npx serve out -l $(PORT)
