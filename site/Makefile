SHELL := /bin/bash

.PHONY: deps dev build start lint typecheck clean preview generate-narration export-videos export-video install-playwright

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

# Export all demo scenarios as MP4 videos (requires ffmpeg on PATH and
# narration audio in public/demos/ — run generate-narration before build)
export-videos: build
	yarn export-videos

# Export a single scenario: make export-video SCENARIO=approval-flow-playback
export-video: build
	yarn export-videos --scenario=$(SCENARIO)

# Install Playwright Chromium browser (one-time setup for video export)
install-playwright:
	npx playwright install chromium

# Remove build artifacts
clean:
	rm -rf .next out node_modules .source .video-tmp dist/videos

# Preview the static build locally
preview: build
	npx serve out -l $(PORT)
