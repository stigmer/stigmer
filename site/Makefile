SHELL := /bin/bash

.PHONY: deps dev build start lint typecheck clean preview

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
	rm -rf .next out node_modules .source

# Preview the static build locally
preview: build
	npx serve out -l $(PORT)
