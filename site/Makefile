SHELL := /bin/bash

.PHONY: deps dev build start lint typecheck clean preview generate-narration

PORT ?= 3000

# Install dependencies (immutable installs disabled because file: workspace
# dependencies produce environment-dependent content hashes)
deps:
	YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install

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

# Generate narration audio from scenario step definitions
generate-narration: deps
	yarn generate-narration

# Remove build artifacts
clean:
	rm -rf .next out node_modules .source

# Preview the static build locally
preview: build
	npx serve out -l $(PORT)
