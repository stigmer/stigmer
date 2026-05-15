bump ?= patch

GO_MODULES := \
	apis/stubs/go \
	backend/libs/go \
	backend/services/stigmer-server \
	backend/services/workflow-runner \
	client-apps/cli \
	mcp-server \
	sdk/go \
	seedpack \
	tools

AGENT_RUNNER_DIR := backend/services/agent-runner
CURSOR_RUNNER_DIR := backend/services/cursor-runner

.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── Setup ────────────────────────────────────

VALE_VERSION ?= 3.9.5

.PHONY: setup install-vale
setup: ## Install all dependencies (one-time)
	@for mod in $(GO_MODULES); do \
		echo "go mod download  $$mod"; \
		(cd $$mod && go mod download) || exit 1; \
	done
	@echo "poetry install   $(AGENT_RUNNER_DIR)"
	@cd $(AGENT_RUNNER_DIR) && poetry install
	@echo "npm install      $(CURSOR_RUNNER_DIR)"
	@cd $(CURSOR_RUNNER_DIR) && npm install
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit install && echo "pre-commit hooks installed"; \
	else \
		echo "tip: brew install pre-commit for git hook support"; \
	fi
	@echo ""
	@echo "--- git hooks (husky) ---"
	@npm install && echo "husky pre-commit hooks installed"
	@echo ""
	@echo "--- docs toolchain ---"
	@$(MAKE) install-vale
	@command -v lychee >/dev/null 2>&1 || { echo "error: lychee not found — brew install lychee"; exit 1; }
	@vale sync && echo "vale packages synced"

install-vale: ## Install Vale prose linter (auto-detects OS)
	@if command -v vale >/dev/null 2>&1; then \
		echo "vale already installed: $$(vale --version)"; \
	else \
		OS=$$(uname -s); \
		case $$OS in \
			Darwin) \
				echo "installing vale via Homebrew..."; \
				brew install vale; \
				;; \
			Linux) \
				ARCH=$$(uname -m); \
				case $$ARCH in \
					x86_64)  VALE_ARCH="64-bit" ;; \
					aarch64|arm64) VALE_ARCH="arm64" ;; \
					*) echo "error: unsupported architecture $$ARCH"; exit 1 ;; \
				esac; \
				echo "installing vale v$(VALE_VERSION) for Linux ($$VALE_ARCH)..."; \
				curl -sSfL "https://github.com/errata-ai/vale/releases/download/v$(VALE_VERSION)/vale_$(VALE_VERSION)_Linux_$$VALE_ARCH.tar.gz" \
					| sudo tar xz -C /usr/local/bin vale; \
				;; \
			*) \
				echo "error: unsupported OS '$$OS'"; \
				echo "install vale manually: https://vale.sh/docs/install"; \
				exit 1; \
				;; \
		esac; \
		echo "vale installed: $$(vale --version)"; \
	fi

# ─── Build ────────────────────────────────────

.PHONY: build build-mcp-server build-java-sdk build-cursor-runner protos codegen gen-narration gen-sdk-docs gen-proto-sdk-docs gen-react-sdk-docs gen-ink-sdk-docs gen-sdk-docs-check gen-proto-sdk-docs-check gen-react-sdk-docs-check gen-ink-sdk-docs-check
build: libs-build build-web verify-desktop docs-build build-mcp-server build-java-sdk build-cursor-runner ## Build all project artifacts
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	cd backend/services/stigmer-server && go build -o ../../../bin/stigmer-server ./cmd/server
	cd backend/services/workflow-runner && go build -o ../../../bin/stigmer-workflow-runner .
	@echo ""
	@echo "built: bin/stigmer, bin/stigmer-server, bin/stigmer-workflow-runner, mcp-server/bin/mcp-server-stigmer"

build-mcp-server: ## Build MCP server binary
	$(MAKE) -C mcp-server build

build-java-sdk: ## Compile Java SDK
	$(MAKE) -C sdk/java build

build-cursor-runner: ## Compile Cursor runner (TypeScript)
	@echo "build    $(CURSOR_RUNNER_DIR)"
	@cd $(CURSOR_RUNNER_DIR) && npm run build

protos: ## Generate protocol buffer stubs and SDK client code
	$(MAKE) -C apis build
	$(MAKE) -C sdk/go codegen
	$(MAKE) -C mcp-server codegen
	$(MAKE) -C sdk/typescript codegen
	$(MAKE) -C sdk/python codegen
	$(MAKE) -C sdk/java codegen

gen-sdk-docs: gen-proto-sdk-docs gen-react-sdk-docs gen-ink-sdk-docs gen-cli-docs ## Generate all SDK reference docs

gen-proto-sdk-docs: ## Generate SDK resource docs from proto schemas
	go run ./tools/codegen/generator --comprehensive --target=sdk-docs \
		--schema-dir tools/codegen/schemas --output-dir docs/sdk/resources --apis-dir apis

gen-react-sdk-docs: ## Generate React SDK reference docs from TypeDoc
	cd sdk/react && npm run typedoc:json
	cd site && yarn generate-react-sdk-docs

gen-ink-sdk-docs: ## Generate Ink SDK reference docs from TypeDoc
	cd sdk/ink && npm run typedoc:json
	cd site && yarn generate-ink-sdk-docs

gen-sdk-docs-check: gen-proto-sdk-docs-check gen-react-sdk-docs-check gen-ink-sdk-docs-check gen-cli-docs-check ## Verify all SDK docs are up to date (CI)

gen-proto-sdk-docs-check: ## Verify proto SDK docs are up to date (CI)
	@tmpdir=$$(mktemp -d) && \
	go run ./tools/codegen/generator --comprehensive --target=sdk-docs \
		--schema-dir tools/codegen/schemas --output-dir "$$tmpdir" --apis-dir apis && \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/sdk/resources/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: proto SDK docs are stale — run 'make gen-proto-sdk-docs'"; exit 1; \
	fi; \
	echo "✓ Proto SDK docs are up to date"

gen-react-sdk-docs-check: ## Verify React SDK docs are up to date (CI)
	@tmpdir=$$(mktemp -d) && \
	(cd sdk/react && npm run typedoc:json) && \
	(cd site && REACT_SDK_DOCS_OUTPUT_DIR="$$tmpdir" yarn generate-react-sdk-docs) && \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/sdk/react/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: React SDK docs are stale — run 'make gen-react-sdk-docs'"; exit 1; \
	fi; \
	echo "✓ React SDK docs are up to date"

gen-ink-sdk-docs-check: ## Verify Ink SDK docs are up to date (CI)
	@tmpdir=$$(mktemp -d) && \
	(cd sdk/ink && npm run typedoc:json) && \
	(cd site && INK_SDK_DOCS_OUTPUT_DIR="$$tmpdir" yarn generate-ink-sdk-docs) && \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/sdk/ink/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: Ink SDK docs are stale — run 'make gen-ink-sdk-docs'"; exit 1; \
	fi; \
	echo "✓ Ink SDK docs are up to date"

gen-cli-docs: ## Generate CLI reference docs from Cobra command tree
	cd client-apps/cli && go run ./cmd/gen-cli-docs --output ../../docs/cli/commands/
	npx prettier --write --prose-wrap always docs/cli/commands/

gen-cli-docs-check: ## Verify CLI docs are up to date (CI)
	@tmpdir=$$(mktemp -d) && \
	(cd client-apps/cli && go run ./cmd/gen-cli-docs --output "$$tmpdir") && \
	for f in "$$tmpdir"/*.mdx; do \
		bn=$$(basename "$$f"); \
		npx prettier --stdin-filepath "docs/cli/commands/$$bn" < "$$f" > "$$f.fmt" 2>/dev/null && mv "$$f.fmt" "$$f"; \
	done; \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/cli/commands/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: CLI docs are stale — run 'make gen-cli-docs'"; exit 1; \
	fi; \
	echo "✓ CLI docs are up to date"

gen-narration: ## Generate narration audio for demo scenarios
	$(MAKE) -C site generate-narration

preview-sync: ## Re-scan client-apps/web and update site/.scenar/ view registry
	npx scenar preview sync --source client-apps/web --output site/.scenar

codegen: protos gen-sdk-docs gen-narration ## Regenerate all derived code (stubs + SDK docs + narration)

# ─── Test ─────────────────────────────────────

.PHONY: test
test: ## Run all unit tests
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done
	@echo "testing  $(AGENT_RUNNER_DIR)"
	@cd $(AGENT_RUNNER_DIR) && poetry run pip install -e . --no-deps -q && poetry run pip install -e ../../libs/python/graphton --no-deps -q && poetry run pip install ../../../apis/stubs/python/stigmer --no-deps -q && poetry run pytest
	@echo "testing  $(CURSOR_RUNNER_DIR)"
	@cd $(CURSOR_RUNNER_DIR) && npm test

# ─── Integration Test ─────────────────────────
# All integration test logic lives in test/integration/Makefile.
# These are thin delegates that pass through env vars.

.PHONY: test-integration
test-integration: ## Run integration tests (offline, no API keys needed)
	$(MAKE) -C test/integration test

.PHONY: test-integration-providers
test-integration-providers: ## Run provider-backed integration tests (auto-fetches API keys from Planton)
	$(MAKE) -C test/integration test-providers

.PHONY: test-integration-agent
test-integration-agent: ## Run agent execution integration tests (auto-fetches API keys from Planton)
	$(MAKE) -C test/integration test-agent

# ─── Tidy ────────────────────────────────────

.PHONY: tidy
tidy: ## Run go mod tidy on all Go modules
	@for mod in $(GO_MODULES); do \
		echo "go mod tidy   $$mod"; \
		(cd $$mod && go mod tidy) || exit 1; \
	done

# ─── Lint & Check ────────────────────────────

.PHONY: fix lint lint-web typecheck-web verify-web run-web build-web clean-web clean-build-web \
       lint-desktop typecheck-desktop verify-desktop launch-desktop build-desktop clean-build-desktop release-desktop-local \
       build-cli install-cli release-cli-local \
       lint-docs lint-docs-audit format-docs format-docs-check check-links libs-build web-build validate-demos tsdoc-check test-demos check check-all
fix: ## Auto-fix linting and formatting issues
	@gofmt -s -w .
	@cd backend/libs/python/graphton && poetry run ruff check --fix .
	@cd $(AGENT_RUNNER_DIR) && poetry run ruff check --fix .
	-npm run lint:fix -w @stigmer/react
	-npm run lint -w client-apps/web -- --fix

lint: ## Run all linters and type checks
	@for mod in $(GO_MODULES); do \
		(cd $$mod && go vet ./...) || exit 1; \
	done
	@gofmt -s -w .
	@$(MAKE) -C apis lint
	@cd backend/libs/python/graphton && poetry run ruff check .
	@cd $(AGENT_RUNNER_DIR) && poetry run ruff check .
	@cd $(AGENT_RUNNER_DIR) && poetry run mypy src/stigmer_runner/grpc_client/ src/stigmer_runner/worker/ --show-error-codes
	npm run typecheck -w @stigmer/sdk
	npm run lint -w @stigmer/react
	npm run typecheck -w @stigmer/react
	npm run lint -w client-apps/web
	@echo "typecheck $(CURSOR_RUNNER_DIR)"
	@cd $(CURSOR_RUNNER_DIR) && npm run typecheck
	$(MAKE) -C site lint
	$(MAKE) -C site typecheck

libs-build:
	npm run build:libs
	npm test

# ─── Client Apps: Web (Next.js) ──────────────

run-web: ## Start web console dev server (Vite/Next)
	npm run dev -w client-apps/web

build-web: libs-build ## Build web console for production
	npm run build -w client-apps/web

clean-web: ## Remove web build artifacts
	rm -rf client-apps/web/out client-apps/web/.next

clean-build-web: clean-web build-web ## Clean + build web console

lint-web: ## Lint web console and React SDK
	npm run lint -w @stigmer/react
	npm run lint -w client-apps/web

typecheck-web: ## Typecheck web console, SDK, and React SDK
	npm run typecheck -w @stigmer/sdk
	npm run typecheck -w @stigmer/react

verify-web: lint-web typecheck-web ## Lint + typecheck web (~30s)

# ─── Client Apps: Desktop (Tauri v2 + Vite + React) ──

launch-desktop: ## Start desktop app in dev mode (Tauri + Vite hot-reload)
	client-apps/desktop/scripts/setup-sidecar-dev.sh
	@if command -v caddy >/dev/null 2>&1 && grep -q 'localhost:9090' client-apps/desktop/.env.development 2>/dev/null; then \
		echo "Starting local dev proxy (:9090 → gRPC-Web :8080 + REST :8081)..."; \
		-pkill -f "grpcwebproxy.*9091" 2>/dev/null || true; \
		caddy stop 2>/dev/null || true; \
		grpcwebproxy --backend_addr=localhost:8080 --run_tls_server=false --allow_all_origins --server_http_debug_port=9091 --server_http_max_read_timeout=120s --server_http_max_write_timeout=120s & \
		sleep 1; \
		caddy start --config client-apps/desktop/scripts/Caddyfile.dev; \
	fi
	npm run tauri dev -w desktop
	@-caddy stop 2>/dev/null || true
	@-pkill -f "grpcwebproxy.*9091" 2>/dev/null || true

build-desktop: ## Build desktop native binary (requires TAURI_SIGNING_PRIVATE_KEY)
	@if [ -z "$$TAURI_SIGNING_PRIVATE_KEY" ] && [ -z "$$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then \
		echo "warning: TAURI_SIGNING_PRIVATE_KEY not set — updater artifacts will not be signed"; \
		echo "  Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH to sign builds"; \
		echo "  Key location: ~/.tauri/stigmer.key"; \
		echo ""; \
	fi
	npm run tauri build -w desktop

clean-build-desktop: ## Clean + build desktop app
	rm -rf client-apps/desktop/dist client-apps/desktop/src-tauri/target
	$(MAKE) build-desktop

lint-desktop: ## Lint desktop app (TypeScript)
	npm run lint -w desktop

typecheck-desktop: ## Typecheck desktop app (TypeScript)
	npm run typecheck -w desktop

verify-desktop: lint-desktop typecheck-desktop ## Lint + typecheck desktop (TS + Rust)
	cd client-apps/desktop/src-tauri && cargo check --quiet

release-desktop-local: ## Debug build + install to /Applications
	client-apps/desktop/scripts/setup-sidecar-dev.sh
	cd client-apps/desktop && \
		cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak && \
		python3 -c "import json; f=open('src-tauri/tauri.conf.json','r+'); c=json.load(f); c.get('bundle',{}).pop('createUpdaterArtifacts',None); f.seek(0); json.dump(c,f,indent=2); f.truncate()" && \
		npm run tauri -- build --debug --bundles app; \
		EXIT_CODE=$$?; \
		mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json; \
		if [ $$EXIT_CODE -ne 0 ]; then exit $$EXIT_CODE; fi
	@echo ""
	@echo "Installing to /Applications..."
	@rm -rf "/Applications/Stigmer.app"
	@cp -R "client-apps/desktop/src-tauri/target/debug/bundle/macos/Stigmer.app" /Applications/
	@echo "Installed: /Applications/Stigmer.app"
	@echo ""
	@echo "Bundle size:"
	@du -sh "client-apps/desktop/src-tauri/target/debug/bundle/macos/Stigmer.app" | awk '{print "  .app bundle: " $$1}'
	@du -sh "client-apps/desktop/src-tauri/target/debug/stigmer" | awk '{print "  binary:      " $$1}'

# ─── Client Apps: CLI (Go) ───────────────────

build-cli: ## Build CLI binary
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "built: bin/stigmer"

install-cli: ## Build CLI with dev flags + install to ~/bin
	@mkdir -p bin $(HOME)/bin
	@cd client-apps/cli && go build -ldflags '$(DEV_LDFLAGS)' -o ../../bin/stigmer .
	@cp bin/stigmer $(HOME)/bin/
	@chmod +x $(HOME)/bin/stigmer
	@echo "installed: $(HOME)/bin/stigmer"
	@stigmer --version 2>/dev/null || echo "cli: development build"

release-cli-local: install-cli ## Alias for install-cli

# ─── Client Apps: Backward-Compat Aliases ────

web-build: build-web
desktop-dev: launch-desktop
desktop-build: build-desktop

validate-demos: ## Run static demo scenario validation (token compliance, manifest alignment)
	$(MAKE) -C site validate-demos

tsdoc-check: ## Validate TSDoc quality for all TypeScript SDKs
	cd sdk/ink && npm run tsdoc:check
	cd sdk/react && npm run tsdoc:check

test-demos: docs-build ## Run Playwright demo e2e tests — slow (~20 min), run explicitly or in CI
	$(MAKE) -C site test-demos

check: tidy fix lint lint-docs format-docs-check tsdoc-check gen-sdk-docs gen-sdk-docs-check check-links build test validate-demos ## Run full CI gate locally

check-all: check test-demos ## Full CI gate including Playwright demo e2e (slow)

# ─── Docs Linting ─────────────────────────────

DOCS_SOURCES = $(shell find docs -path docs/_archive -prune -o \( -name '*.md' -o -name '*.mdx' \) -print)

lint-docs: ## Lint documentation with Vale (strict, fails on warnings+)
	@command -v vale >/dev/null 2>&1 || { \
		echo ""; \
		echo "error: vale is not installed."; \
		echo ""; \
		echo "  make install-vale   — auto-detect OS and install"; \
		echo "  brew install vale   — macOS only"; \
		echo "  https://vale.sh    — manual install"; \
		echo ""; \
		exit 1; \
	}
	@vale sync 2>/dev/null
	@vale $(DOCS_SOURCES)

lint-docs-audit: ## Audit docs with Vale (non-blocking report)
	-@vale sync 2>/dev/null
	-@vale $(DOCS_SOURCES)

format-docs: ## Format documentation with Prettier
	@npx prettier --write --prose-wrap always $(DOCS_SOURCES)

format-docs-check: ## Check documentation formatting (CI, no writes)
	@npx prettier --check --prose-wrap always $(DOCS_SOURCES)

check-links: ## Check for broken links in documentation
	@command -v lychee >/dev/null 2>&1 || { \
		echo ""; \
		echo "error: lychee is not installed."; \
		echo ""; \
		echo "  brew install lychee   — macOS"; \
		echo "  cargo install lychee  — any platform"; \
		echo "  https://lychee.cli.rs — manual install"; \
		echo ""; \
		exit 1; \
	}
	@lychee --config .lychee.toml --root-dir . docs/

# ─── Dependencies ─────────────────────────────

.PHONY: update-deps
update-deps: ## Regenerate agent-runner requirements.txt from poetry.lock
	@cd $(AGENT_RUNNER_DIR) && poetry show --only main --no-ansi \
		| awk '{ name=$$1; ver=$$2; if (name=="graphton" || name=="stigmer-protos") next; printf "%s==%s\n", name, ver }' \
		| sort > /tmp/stigmer-ar-deps.txt
	@cd $(AGENT_RUNNER_DIR) && poetry show pathspec --no-ansi >/dev/null 2>&1 \
		&& echo "pathspec==$$(cd $(AGENT_RUNNER_DIR) && poetry show pathspec --no-ansi | awk '/version/{print $$3}')" >> /tmp/stigmer-ar-deps.txt \
		&& sort -o /tmp/stigmer-ar-deps.txt /tmp/stigmer-ar-deps.txt || true
	@{ echo "# Auto-generated from poetry.lock — do not edit manually."; \
	   echo "# Regenerate with: make update-deps"; \
	   echo "#"; \
	   echo "# This file lists all PyPI dependencies (direct + transitive) needed to run"; \
	   echo "# agent-runner inside the hermetic pythonrt venv.  Path dependencies (graphton,"; \
	   echo "# stigmer-protos) are excluded; they are installed separately from the local"; \
	   echo "# source tree by the bootstrap pipeline."; \
	   cat /tmp/stigmer-ar-deps.txt; \
	} > $(AGENT_RUNNER_DIR)/requirements.txt
	@rm -f /tmp/stigmer-ar-deps.txt
	@echo "updated: $(AGENT_RUNNER_DIR)/requirements.txt ($$(wc -l < $(AGENT_RUNNER_DIR)/requirements.txt | tr -d ' ') lines)"


# ─── Local Dev ────────────────────────────────

DEV_LDFLAGS := -X github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner.devSourceDir=$(CURDIR)/backend/services/agent-runner \
               -X github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner.devSourceDir=$(CURDIR)/backend/services/cursor-runner

.PHONY: local
local: ## Build + install CLI, server, and workflow-runner for local development
	@rm -f $(HOME)/bin/stigmer $(HOME)/bin/stigmer-server $(HOME)/bin/stigmer-workflow-runner 2>/dev/null || true
	@rm -f /usr/local/bin/stigmer bin/stigmer bin/stigmer-server bin/stigmer-workflow-runner 2>/dev/null || true
	@$(MAKE) web-console-build
	@mkdir -p bin $(HOME)/bin
	@cd client-apps/cli && go build -tags 'embed_webconsole' -ldflags '$(DEV_LDFLAGS)' -o ../../bin/stigmer .
	@cd backend/services/stigmer-server && go build -o ../../../bin/stigmer-server ./cmd/server
	@cd backend/services/workflow-runner && go build -o ../../../bin/stigmer-workflow-runner .
	@cp bin/stigmer bin/stigmer-server bin/stigmer-workflow-runner $(HOME)/bin/
	@chmod +x $(HOME)/bin/stigmer $(HOME)/bin/stigmer-server $(HOME)/bin/stigmer-workflow-runner
	@echo "installed: $(HOME)/bin/stigmer, stigmer-server, stigmer-workflow-runner"
	@stigmer --version 2>/dev/null || echo "cli: development build"
	@echo ""
	@echo "stigmer server will auto-detect API keys from your environment."
	@echo ""
	@echo "  Option 1 (recommended):       export ANTHROPIC_API_KEY=sk-ant-..."
	@echo "  Option 2:                      export OPENAI_API_KEY=sk-..."
	@echo "  Option 3 (local, lower quality): brew install ollama && ollama serve"
	@echo ""
	@echo "Then run:  stigmer server"
	@echo ""

web-console-build:
	@if [ ! -d node_modules ]; then \
		echo "error: node_modules not found — run 'npm install' first"; exit 1; \
	fi
	npm run build -w client-apps/web
	@rm -rf client-apps/cli/embedded/webconsole/out
	@cp -r client-apps/web/out client-apps/cli/embedded/webconsole/out
	@echo "copied: client-apps/web/out -> client-apps/cli/embedded/webconsole/out"

# ─── Site ─────────────────────────────────────

.PHONY: site run-site build-site clean-build-site preview-site preview docs-build gen-llms

site: run-site ## Start the documentation website with hot reload

run-site:
	$(MAKE) -C site dev

build-site: lint-docs
	$(MAKE) -C site build
	@if ! git diff --quiet site/yarn.lock 2>/dev/null; then \
		echo ""; \
		echo "WARNING: site/yarn.lock was updated by yarn install."; \
		echo "Commit the updated lockfile before pushing:"; \
		echo ""; \
		echo "  git add site/yarn.lock"; \
		echo ""; \
	fi

clean-build-site:
	$(MAKE) -C site clean
	$(MAKE) build-site

preview-site:
	$(MAKE) -C site preview

preview: preview-site

docs-build: build-site ## Build the documentation site (production)

gen-llms: ## Generate LLM-friendly output (llms.txt, llms-full.txt, per-page .md)
	cd site && yarn generate-llms

# ─── Release ──────────────────────────────────

.PHONY: release
release: ## Tag and push a release (usage: make release [bump=patch|minor|major])
	@LATEST_TAG=$$(git tag -l "v*" | sort -V | tail -n1); \
	[ -z "$$LATEST_TAG" ] && LATEST_TAG="v0.0.0"; \
	VERSION=$$(echo $$LATEST_TAG | sed 's/^v//'); \
	MAJOR=$$(echo $$VERSION | cut -d. -f1); \
	MINOR=$$(echo $$VERSION | cut -d. -f2); \
	PATCH=$$(echo $$VERSION | cut -d. -f3); \
	case $(bump) in \
		major) MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0 ;; \
		minor) MINOR=$$((MINOR + 1)); PATCH=0 ;; \
		patch) PATCH=$$((PATCH + 1)) ;; \
		*) echo "error: invalid bump '$(bump)' (use patch|minor|major)" && exit 1 ;; \
	esac; \
	NEW_TAG="v$$MAJOR.$$MINOR.$$PATCH"; \
	if git rev-parse "$$NEW_TAG" >/dev/null 2>&1; then \
		echo "error: tag $$NEW_TAG already exists" && exit 1; \
	fi; \
	echo "$$LATEST_TAG -> $$NEW_TAG"; \
	git tag -a "sdk/go/$$NEW_TAG" -m "Release sdk/go $$NEW_TAG"; \
	git tag -a "mcp-server/$$NEW_TAG" -m "Release mcp-server $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "Release $$NEW_TAG"; \
	for t in "sdk/go/$$NEW_TAG" "mcp-server/$$NEW_TAG" "$$NEW_TAG"; do \
		echo "  pushing $$t"; \
		git push origin "$$t"; \
	done
	@echo ""
	@echo "Tags pushed. CI will handle:"
	@echo "  - Protos to BSR                  (release.buf.yaml)"
	@echo "  - CLI binaries + GitHub release  (release.cli.yaml)"
	@echo "  - Desktop app installers (draft) (release.desktop.yaml)"
	@echo "  - @stigmer/* npm packages        (release.npm-libs.yaml)"
	@echo "  - Go SDK (go get)                (sdk/go tag auto-cached by proxy.golang.org)"
	@echo "  - stigmer + stigmer-protos PyPI  (release.python-sdk.yaml)"
	@echo "  - MCP server binaries + Docker   (release.mcp-server.yaml)"

# ─── Clean ────────────────────────────────────

.PHONY: clean
clean: ## Remove all build artifacts
	rm -rf bin/ coverage/ coverage.txt coverage.html
	rm -rf backend/services/stigmer-server/bin/
	rm -rf backend/services/workflow-runner/bin/
	rm -rf client-apps/cli/embedded/agentrunner/source/
	rm -rf client-apps/cli/embedded/cursorrunner/source/
	rm -rf client-apps/cli/embedded/webconsole/out/
	rm -rf client-apps/web/out/ client-apps/web/.next/
	$(MAKE) -C apis clean
