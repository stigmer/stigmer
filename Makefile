bump ?= patch

GO_MODULES := \
	apis/stubs/go \
	sdk/go \
	seedpack \
	tools

RUNNER_DIR := backend/services/runner
SERVER_DIR := backend/services/stigmer-server

# Prettier renders formatting VERDICTS (format-docs-check, the gen-*-docs-check
# freshness gates), so it must always run at the version package-lock.json pins.
# Bare `npx prettier` is nondeterministic: when no node_modules exists on the
# directory walk-up path (a fresh worktree outside this checkout, a machine
# that never ran `npm install`), npx silently downloads the LATEST release —
# and prettier releases change markdown formatting, so the same bytes pass on
# one machine and fail on another (oss#531). Invoke the installed binary
# directly, and fail loudly when it is missing instead of letting npx guess.
PRETTIER := node_modules/.bin/prettier
PRETTIER_GUARD := test -x $(PRETTIER) || { echo "error: $(PRETTIER) not found — run 'npm install' at the repo root (prettier must run at the version package-lock.json pins)"; exit 1; }

.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── Setup ────────────────────────────────────

VALE_VERSION ?= 3.9.5

.PHONY: setup bootstrap-runner install-vale
setup: ## Install all dependencies (one-time)
	@for mod in $(GO_MODULES); do \
		echo "go mod download  $$mod"; \
		(cd $$mod && go mod download) || exit 1; \
	done
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
	@echo ""
	@echo "--- runner (TypeScript) ---"
	@$(MAKE) bootstrap-runner

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

.PHONY: build build-java-protos build-java-sdk build-runner build-runner-slim build-server protos codegen build-ts-stubs gen-narration gen-sdk-docs gen-proto-sdk-docs gen-react-sdk-docs gen-ink-sdk-docs gen-theme-docs gen-task-docs gen-task-registry gen-task-registry-check gen-sdk-docs-check gen-proto-sdk-docs-check gen-react-sdk-docs-check gen-ink-sdk-docs-check gen-theme-docs-check gen-task-docs-check gen-ipc-fixtures gen-ipc-fixtures-check stubs-internal-check
build: libs-build build-web verify-desktop docs-build build-java-sdk build-runner build-server ## Build all project artifacts
	@echo ""
	@echo "built: the server ($(SERVER_DIR)/dist) and runner (the CLI ships as the @stigmer/cli npm package)"

build-java-protos: ## Install Java proto stubs to local Maven repo
	@echo "mvn install  apis/stubs/java"
	@cd apis/stubs/java && mvn install -q

build-java-sdk: build-java-protos ## Compile Java SDK
	$(MAKE) -C sdk/java build

# Root workspace deps — reinstall only when the root manifest changes.
# Provides the hoisted toolchain (e.g. typescript) used to build proto stubs.
node_modules: package.json
	@echo "npm install  (root workspace deps)"
	@npm install
	@touch node_modules

# The runner is NOT an npm workspace (see root package.json), so its deps
# install independently. Reinstall only when the runner manifest changes.
$(RUNNER_DIR)/node_modules: $(RUNNER_DIR)/package.json
	@echo "npm install  $(RUNNER_DIR)"
	@cd $(RUNNER_DIR) && npm install
	@touch $(RUNNER_DIR)/node_modules

bootstrap-runner: node_modules build-ts-stubs $(RUNNER_DIR)/node_modules ## One-shot prep for the TS runner (proto stubs + deps)
	@echo "runner ready: @stigmer/protos dist built + $(RUNNER_DIR) deps installed"

build-runner: build-ts-stubs $(RUNNER_DIR)/node_modules ## Compile unified runner (TypeScript)
	@echo "build    $(RUNNER_DIR)"
	@cd $(RUNNER_DIR) && npm run build

build-runner-slim: build-runner ## Build the slim embedding artifact (dist-slim/, see stigmer/stigmer#170)
	@echo "bundle   $(RUNNER_DIR)/dist-slim"
	@cd $(RUNNER_DIR) && node scripts/bundle-slim.mjs

# The TS server follows the runner's standalone-package model: own lockfile,
# file:-linked @stigmer/protos, NOT an npm workspace (D2 §5 of the OSS TS
# server blueprint).
$(SERVER_DIR)/node_modules: $(SERVER_DIR)/package.json
	@echo "npm install  $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npm install
	@touch $(SERVER_DIR)/node_modules

build-server: build-ts-stubs $(SERVER_DIR)/node_modules ## Compile the TypeScript server
	@echo "build    $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npm run build

protos: ## Generate protocol buffer stubs and SDK client code
	$(MAKE) -C apis build
	$(MAKE) -C sdk/go codegen
	$(MAKE) -C mcp-server codegen
	$(MAKE) -C sdk/typescript codegen
	$(MAKE) -C sdk/python codegen
	$(MAKE) -C sdk/java codegen

gen-sdk-docs: gen-proto-sdk-docs gen-react-sdk-docs gen-ink-sdk-docs gen-theme-docs gen-cli-docs gen-task-docs gen-task-registry ## Generate all SDK reference docs

gen-proto-sdk-docs: ## Generate SDK resource docs from proto schemas
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=sdk-docs \
		--schema-dir tools/codegen/schemas --output-dir docs/sdk/resources --apis-dir apis

gen-task-docs: ## Generate per-task reference docs from schemas
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=task-docs \
		--schema-dir tools/codegen/schemas --output-dir docs/guides/workflows/task-types \
		--meta-dir apis/ai/stigmer/agentic/workflow/v1/tasks/meta --apis-dir apis
	@$(PRETTIER_GUARD)
	$(PRETTIER) --write --prose-wrap always docs/guides/workflows/task-types/*.mdx

# The JSON Schemas live at their generator home (tools/codegen/output only):
# the server bundles just the registry JSON (registry/bundled.ts), so the
# per-schema copy the Go embed carried retired with the Go server (D4 #25).
gen-task-registry: ## Generate task-kind-registry.json + JSON Schemas and sync the registry into the server bundle
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@# The generator validates sidecar YAML examples against the typed proto
	@# messages via @stigmer/protos, which must be built first (incremental).
	@npm run build -w @stigmer/protos --silent
	node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=task-registry \
		--schema-dir tools/codegen/schemas --output-dir tools/codegen/output \
		--meta-dir apis/ai/stigmer/agentic/workflow/v1/tasks/meta
	cp tools/codegen/output/task-kind-registry.json \
		$(SERVER_DIR)/src/domain/workflow/registry/data/task-kind-registry.json

# Source of truth for the model registry is the cloud platform's database
# (DD-004: baseline + ledger-derived overrides, served publicly). The bundled
# copy here is a build-time snapshot: the server prefers a live refresh from
# the same endpoint at runtime (see registry.ModelRegistryStore), so this
# target is a convenience that keeps the offline fallback reasonably fresh —
# it is no longer correctness-critical.
MODEL_REGISTRY_UPSTREAM ?= https://api.stigmer.ai

MODEL_REGISTRY_DATA := $(SERVER_DIR)/src/domain/workflow/registry/data

sync-model-registry: ## Refresh the bundled model-registry.json snapshot from the public cloud endpoint
	@curl -fsSL "$(MODEL_REGISTRY_UPSTREAM)/api/v1/public/model-registry" \
		-o $(MODEL_REGISTRY_DATA)/model-registry.json.tmp \
		|| { echo "error: could not fetch $(MODEL_REGISTRY_UPSTREAM)/api/v1/public/model-registry"; \
		     rm -f $(MODEL_REGISTRY_DATA)/model-registry.json.tmp; \
		     exit 1; }
	@mv $(MODEL_REGISTRY_DATA)/model-registry.json.tmp \
		$(MODEL_REGISTRY_DATA)/model-registry.json
	@echo "✓ model-registry.json snapshot refreshed from $(MODEL_REGISTRY_UPSTREAM)"

gen-task-registry-check: ## Verify the task kind registry is up to date and synced (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=task-registry \
		--schema-dir tools/codegen/schemas --output-dir tools/codegen/output \
		--meta-dir apis/ai/stigmer/agentic/workflow/v1/tasks/meta && \
	if ! diff -q tools/codegen/output/task-kind-registry.json \
		$(SERVER_DIR)/src/domain/workflow/registry/data/task-kind-registry.json > /dev/null 2>&1; then \
		echo "error: task kind registry is stale or unsynced — run 'make gen-task-registry'"; exit 1; \
	fi; \
	if ! git diff --quiet tools/codegen/output/task-kind-registry.json tools/codegen/output/json-schemas/; then \
		echo "error: task kind registry is stale — run 'make gen-task-registry'"; exit 1; \
	fi; \
	echo "✓ Task kind registry is up to date"

stubs-internal-check: ## Verify committed stubs carry no @internal comment sections (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@node_modules/.bin/tsx tools/codegen/src/stubscrub/main.ts -check apis/stubs sdk/go/proto

gen-react-sdk-docs: ## Generate React SDK reference docs from TypeDoc
	cd sdk/react && npm run typedoc:json
	cd site && yarn generate-react-sdk-docs

gen-ink-sdk-docs: ## Generate Ink SDK reference docs from TypeDoc
	cd sdk/ink && npm run typedoc:json
	cd site && yarn generate-ink-sdk-docs

gen-theme-docs: ## Generate theme token reference docs from tokens.css
	cd site && yarn generate-theme-docs

gen-sdk-docs-check: gen-proto-sdk-docs-check gen-react-sdk-docs-check gen-ink-sdk-docs-check gen-theme-docs-check gen-cli-docs-check gen-task-docs-check gen-task-registry-check ## Verify all SDK docs are up to date (CI)

gen-proto-sdk-docs-check: ## Verify proto SDK docs are up to date (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@tmpdir=$$(mktemp -d) && \
	node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=sdk-docs \
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

gen-task-docs-check: ## Verify task docs are up to date (CI)
	@$(PRETTIER_GUARD)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@tmpdir=$$(mktemp -d) && \
	node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=task-docs \
		--schema-dir tools/codegen/schemas --output-dir "$$tmpdir" \
		--meta-dir apis/ai/stigmer/agentic/workflow/v1/tasks/meta --apis-dir apis && \
	$(PRETTIER) --write --prose-wrap always --config .prettierrc --ignore-path /dev/null "$$tmpdir"/*.mdx > /dev/null 2>&1; \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/guides/workflows/task-types/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: task docs are stale — run 'make gen-task-docs'"; exit 1; \
	fi; \
	echo "✓ Task docs are up to date"

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

gen-theme-docs-check: ## Verify theme token docs are up to date (CI)
	@tmpdir=$$(mktemp -d) && \
	(cd site && THEME_DOCS_OUTPUT_DIR="$$tmpdir" yarn generate-theme-docs) && \
	rc=0; \
	for f in "$$tmpdir"/*; do \
		if ! diff -q "$$f" "docs/sdk/theme/$$(basename $$f)" > /dev/null 2>&1; then \
			rc=1; break; \
		fi; \
	done; \
	rm -rf "$$tmpdir"; \
	if [ $$rc -ne 0 ]; then \
		echo "error: theme token docs are stale — run 'make gen-theme-docs'"; exit 1; \
	fi; \
	echo "✓ Theme token docs are up to date"

gen-cli-docs: ## Generate CLI reference docs from the TypeScript command tree
	cd client-apps/cli && npx tsx scripts/gen-cli-docs.ts --output ../../docs/cli/commands/
	@$(PRETTIER_GUARD)
	$(PRETTIER) --write --prose-wrap always docs/cli/commands/

gen-cli-docs-check: ## Verify CLI docs are up to date (CI)
	@$(PRETTIER_GUARD)
	@tmpdir=$$(mktemp -d) && \
	(cd client-apps/cli && npx tsx scripts/gen-cli-docs.ts --output "$$tmpdir") && \
	for f in "$$tmpdir"/*; do \
		bn=$$(basename "$$f"); \
		$(PRETTIER) --stdin-filepath "docs/cli/commands/$$bn" < "$$f" > "$$f.fmt" 2>/dev/null && mv "$$f.fmt" "$$f"; \
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

codegen: protos build-ts-stubs gen-sdk-docs gen-narration gen-ipc-fixtures ## Regenerate all derived code (stubs + SDK docs + narration + IPC fixtures)

gen-ipc-fixtures: $(RUNNER_DIR)/node_modules ## Regenerate golden IPC fixtures from ipc-protocol.ts (runner artifact + crate copy)
	@cd $(RUNNER_DIR) && npm run gen:ipc-fixtures

gen-ipc-fixtures-check: $(RUNNER_DIR)/node_modules ## Verify golden IPC fixtures are fresh (CI) — fails if the contract changed without regenerating
	@cd $(RUNNER_DIR) && npm run gen:ipc-fixtures -- --check

build-ts-stubs: node_modules ## Rebuild the runner-linked workspace lib dists (@stigmer/protos after stub regeneration + @stigmer/temporal-codecs)
	npm run build:runner-deps

# ─── Test ─────────────────────────────────────

.PHONY: test
test: ## Run all unit tests
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done
	@$(MAKE) test-runner

.PHONY: test-runner
test-runner: $(RUNNER_DIR)/node_modules ## Run the unified runner vitest suite (CI env caps fork concurrency)
	@echo "testing  $(RUNNER_DIR)"
	@cd $(RUNNER_DIR) && npm test

.PHONY: test-server
test-server: build-ts-stubs $(SERVER_DIR)/node_modules ## Run the TypeScript server vitest suite
	@echo "testing  $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npm test

# The consumer compiles a fake extension against the @stigmer/server
# exports map ALONE (DD-005): a missing export is a tsc failure here, not
# a review miss. Standalone package with a file: link — the exact posture
# the commit-pin consumer (the cloud composition) occupies.
.PHONY: test-extension-consumer
test-extension-consumer: build-server ## Compile-proof the @stigmer/server library contract via test/extension-consumer
	@echo "compile-proof  test/extension-consumer (the exports-map contract)"
	@cd test/extension-consumer && npm ci --no-audit --no-fund && npm run typecheck

# ─── Integration Test ─────────────────────────
# Integration test logic lives in each suite's Makefile under test/.
# These are thin delegates that pass through env vars.
# Use `make test-integration-all` to run all suites (PROVIDERS=true for provider-backed);
# it also runs the gRPC conformance suite (see the Conformance Test section below).

.PHONY: test-integration
test-integration: ## Run integration tests (offline, no API keys needed)
	$(MAKE) -C test/integration test

.PHONY: test-integration-providers
test-integration-providers: ## Run provider-backed integration tests (auto-fetches API keys from Planton)
	$(MAKE) -C test/integration test-providers

.PHONY: test-integration-agent
test-integration-agent: ## Run agent execution integration tests (auto-fetches API keys from Planton)
	$(MAKE) -C test/integration test-agent

.PHONY: test-integration-stress
test-integration-stress: ## Run integration tests 3x to detect flakes (no quarantine skip)
	$(MAKE) -C test/integration test-stress

.PHONY: test-integration-security
test-integration-security: ## Run security integration tests (JWT validation, production auth chain)
	$(MAKE) -C test/integration-security test

.PHONY: test-integration-session-routing
test-integration-session-routing: ## Run offline session routing integration tests (no API keys needed)
	$(MAKE) -C test/integration-session-routing test

.PHONY: test-integration-session-routing-providers
test-integration-session-routing-providers: ## Run provider-backed session routing E2E tests (auto-fetches CURSOR_API_KEY)
	$(MAKE) -C test/integration-session-routing test-providers

.PHONY: test-integration-wfexec-routing
test-integration-wfexec-routing: ## Run offline workflow execution routing tests (no API keys needed)
	$(MAKE) -C test/integration-wfexec-routing test

.PHONY: test-integration-offline
test-integration-offline: ## Run deterministic offline integration tests (recorded LLM responses, no API keys)
	$(MAKE) -C test/integration-offline test

.PHONY: test-integration-canary
test-integration-canary: ## Run canary tests (live provider health checks, needs API keys)
	$(MAKE) -C test/integration test-canary

.PHONY: test-integration-all
test-integration-all: ## Run all integration suites. PROVIDERS=true includes provider-backed tests.
	@echo "=== Offline: integration ==="
	$(MAKE) test-integration
	@echo "=== Offline: security ==="
	$(MAKE) test-integration-security
	@echo "=== Offline: session-routing ==="
	$(MAKE) test-integration-session-routing
	@echo "=== Offline: wfexec-routing ==="
	$(MAKE) test-integration-wfexec-routing
	@echo "=== Offline: deterministic (recorded LLM) ==="
	$(MAKE) test-integration-offline
	@echo "=== Conformance: CRUD contract (local) ==="
	$(MAKE) test-conformance
	@echo "=== Conformance: execution engine (local-execution) ==="
	$(MAKE) test-conformance-execution
ifeq ($(PROVIDERS),true)
	@echo "=== Provider: integration (LLM) ==="
	$(MAKE) test-integration-providers
	@echo "=== Provider: session-routing (Cursor) ==="
	$(MAKE) test-integration-session-routing-providers
endif
	@echo "All integration suites complete."

# ─── Conformance Test (gRPC API contract) ─────
# The conformance suite (test/conformance, @stigmer/conformance) is an
# implementation-agnostic gRPC contract, distinct from the integration suites
# above: it is a TypeScript/vitest workspace that builds the OSS server from
# source and drives it through generated Connect clients — the shared
# contract that turns OSS<->cloud behavioral drift into a failing test. The
# two slices are deliberately separate (DD-002): the dependency-light CRUD
# signal stays fast, while execution additionally needs the `temporal` CLI
# and a runner build. See test/conformance/README.md.

.PHONY: test-conformance
test-conformance: build-ts-stubs ## Run gRPC conformance CRUD suite (local; builds the server from source, no Temporal)
	@echo "=== conformance: CRUD contract (local) ==="
	CONFORMANCE_TARGET=local npm run test -w @stigmer/conformance

.PHONY: test-conformance-execution
test-conformance-execution: build-runner ## Run gRPC conformance execution suite (local-execution; needs the `temporal` and `stigmer` CLIs)
	@command -v temporal >/dev/null 2>&1 || { \
		echo "error: temporal CLI not found — the dev server backs the execution harness"; \
		echo "  install: curl -sSf https://temporal.download/cli.sh | sh"; \
		exit 1; \
	}
	@command -v stigmer >/dev/null 2>&1 || { \
		echo "error: stigmer CLI not found — memory-enabled executions spawn 'stigmer mcp-server'"; \
		echo "  as the capture tool's stdio child (runner shared/memory-attachment.ts); without"; \
		echo "  it those executions FAIL instead of skipping."; \
		echo "  install the from-source shim: make install-cli-shim   (writes ~/bin/stigmer)"; \
		exit 1; \
	}
	@echo "=== conformance: execution engine (local-execution) ==="
	CONFORMANCE_TARGET=local-execution npm run test:execution -w @stigmer/conformance

.PHONY: postgres-dev
postgres-dev: ## Start a throwaway Postgres 16 for the postgres targets (docker; port 55432)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the postgres targets need a real Postgres (DD-011)"; exit 1; }
	@docker rm -f stigmer-postgres-dev >/dev/null 2>&1 || true
	docker run -d --name stigmer-postgres-dev -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine
	@until docker exec stigmer-postgres-dev pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done
	@echo "Postgres 16 ready. Export for the postgres test lanes:"
	@echo "  export CONFORMANCE_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres"
	@echo "  export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres"
	@echo "Stop with: docker rm -f stigmer-postgres-dev"

.PHONY: test-conformance-postgres
test-conformance-postgres: build-ts-stubs ## Run gRPC conformance CRUD suite on the Postgres driver (needs CONFORMANCE_POSTGRES_URL; see `make postgres-dev`)
	@test -n "$$CONFORMANCE_POSTGRES_URL" || { \
		echo "error: CONFORMANCE_POSTGRES_URL is not set — the postgres targets need a real Postgres."; \
		echo "  start one: make postgres-dev"; \
		exit 1; \
	}
	@echo "=== conformance: CRUD contract (local-postgres) ==="
	CONFORMANCE_TARGET=local-postgres npm run test -w @stigmer/conformance

.PHONY: test-conformance-postgres-execution
test-conformance-postgres-execution: build-runner ## Run gRPC conformance execution suite on the Postgres driver (needs CONFORMANCE_POSTGRES_URL + the `temporal` and `stigmer` CLIs)
	@test -n "$$CONFORMANCE_POSTGRES_URL" || { \
		echo "error: CONFORMANCE_POSTGRES_URL is not set — the postgres targets need a real Postgres."; \
		echo "  start one: make postgres-dev"; \
		exit 1; \
	}
	@command -v temporal >/dev/null 2>&1 || { \
		echo "error: temporal CLI not found — the dev server backs the execution harness"; \
		echo "  install: curl -sSf https://temporal.download/cli.sh | sh"; \
		exit 1; \
	}
	@command -v stigmer >/dev/null 2>&1 || { \
		echo "error: stigmer CLI not found — memory-enabled executions spawn 'stigmer mcp-server'"; \
		echo "  install the from-source shim: make install-cli-shim   (writes ~/bin/stigmer)"; \
		exit 1; \
	}
	@echo "=== conformance: execution engine (local-postgres-execution) ==="
	CONFORMANCE_TARGET=local-postgres-execution npm run test:execution -w @stigmer/conformance

# build-web rides the dependency list because bundle-slim stages the web
# console's static export into the artifact (DD-012) and loud-fails
# without a built client-apps/web/out.
.PHONY: smoke-cli-cutover
smoke-cli-cutover: build-runner build-server build-web ## Run the CLI E2E smoke: `stigmer up` against the packaged slim server artifact (needs `temporal` on PATH for speed)
	@command -v node >/dev/null 2>&1 || { echo "error: node not found"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs
	node scripts/smoke-cli-cutover.mjs

# The bundle targets linux for THIS machine's arch (the docker daemon's
# native platform), not the host OS — the smoke builds a linux container.
.PHONY: smoke-docker-image
smoke-docker-image: build-server build-web ## Build the server Docker image from a fresh slim bundle and boot-smoke it (DD-014; needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the image smoke needs a Docker daemon"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs --platform=linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")
	@cd $(SERVER_DIR) && node scripts/smoke-docker-image.mjs

# The compose gate (DD-013, Phase-2 P5): build both images from source and
# prove the full self-host stack — server + Postgres + Temporal + runner —
# up to one end-to-end workflow run. The same script the PR gate
# (ci.compose-stack.yaml) and the release lane run. Fixed ports 7234/7235:
# stop any running `stigmer up` first.
.PHONY: smoke-compose
smoke-compose: build-server build-web ## Build the compose stack from source and run the clean-clone gate smoke (DD-013; needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the compose smoke needs a Docker daemon"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs --platform=linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")
	node scripts/smoke-compose.mjs --build

.PHONY: test-conformance-cloud
test-conformance-cloud: build-ts-stubs ## Run gRPC conformance CRUD suite against the Java cloud service (hermetic; needs Docker, `fga`, `temporal`, and the fat JAR)
	@command -v go >/dev/null 2>&1 || { echo "error: go not found — the harness builds the cloud environment launcher"; exit 1; }
	@command -v fga >/dev/null 2>&1 || { \
		echo "error: fga CLI not found — required to load the OpenFGA authorization model"; \
		echo "  install: brew install openfga/tap/fga"; \
		exit 1; \
	}
	@command -v temporal >/dev/null 2>&1 || { \
		echo "error: temporal CLI not found — the dev server backs the Java service"; \
		echo "  install: curl -sSf https://temporal.download/cli.sh | sh"; \
		exit 1; \
	}
	@echo "=== conformance: CRUD contract (cloud / Java stigmer-service) ==="
	@echo "    (JAR from STIGMER_SERVICE_JAR or the sibling stigmer-cloud bazel-bin;"
	@echo "     build it with: cd ../stigmer-cloud && ./bazelw build //backend/services/stigmer-service:stigmer_service_fatjar)"
	npm run test:cloud -w @stigmer/conformance

.PHONY: test-conformance-all
test-conformance-all: ## Run both conformance slices (CRUD + execution)
	$(MAKE) test-conformance
	$(MAKE) test-conformance-execution
	@echo "Conformance suite complete (local + local-execution)."

.PHONY: test-replay
test-replay: ## Run Temporal workflow replay determinism tests (fast, no infra needed)
	@echo "test-replay: workflow-runner has been removed (unified into runner)"

.PHONY: capture-replay-histories
capture-replay-histories: ## Capture Temporal event histories for replay tests (needs full harness)
	$(MAKE) -C test/integration capture-replay-histories

.PHONY: benchmark-cost
benchmark-cost: ## Run cost benchmarks comparing Native vs Cursor harness execution costs
	$(MAKE) -C test/integration benchmark-cost

.PHONY: benchmark-cursor-modes
benchmark-cursor-modes: ## Compare Cursor local vs cloud runtime latency and token usage
	$(MAKE) -C test/integration benchmark-cursor-modes

# ─── Seedpack Testing ────────────────────────

.PHONY: test-seedpack-static test-seedpack-transport test-seedpack-canary

test-seedpack-static: ## Run seedpack static validation tests (fast, no network)
	cd seedpack && go test -v -count=1 ./...

# Runs the seedpack module with the `transport` build tag, which compiles in
# the live HTTP probes (seedpack/transport_test.go) alongside the static
# validation tests — no harness, no service JAR (the probes moved out of
# test/integration's full-stack TestMain, oss#569). The static tests riding
# along cost sub-second and fail with a clearer message than a probe would
# when a YAML itself is broken. gotestsum for the junit.xml the nightly
# ci.seedpack-canary lane's test report consumes.
test-seedpack-transport: ## Run seedpack transport reachability tests (network required, nightly)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p seedpack/.test-output-transport
	cd seedpack && gotestsum \
		--junitfile .test-output-transport/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile .test-output-transport/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags transport -timeout 120s -count=1

test-seedpack-canary: ## Run seedpack canary tests with real credentials (nightly)
	$(MAKE) -C test/integration test-seedpack-canary

# ─── Tidy ────────────────────────────────────

.PHONY: tidy
tidy: ## Run go mod tidy on all Go modules
	@for mod in $(GO_MODULES); do \
		echo "go mod tidy   $$mod"; \
		(cd $$mod && go mod tidy) || exit 1; \
	done

# ─── Lint & Check ────────────────────────────

.PHONY: fix lint lint-web typecheck-web verify-web run-web build-web clean-web clean-build-web \
       lint-desktop typecheck-desktop verify-desktop kill-desktop launch-desktop build-desktop clean-build-desktop release-desktop-local \
       lint-docs lint-docs-audit format-docs format-docs-check check-links libs-build web-build validate-demos tsdoc-check test-demos \
       check-docs-inventory \
       test-web test-desktop test-runner-host test-e2e test-e2e-approval test-a11y check check-all \
       check-prep check-go check-node check-site check-rust check-java check-bazel
fix: ## Auto-fix linting and formatting issues
	@gofmt -s -w .
	-npm run lint:fix -w @stigmer/react
	-npm run lint -w client-apps/web -- --fix

lint: ## Run all linters and type checks
	@for mod in $(GO_MODULES); do \
		(cd $$mod && go vet ./...) || exit 1; \
	done
	@gofmt -s -w .
	@$(MAKE) -C apis lint
	npm run typecheck -w @stigmer/sdk
	npm run lint -w @stigmer/react
	npm run typecheck -w @stigmer/react
	npm run lint -w client-apps/web
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

verify-web-routing: ## Verify every web route resolves through nginx.conf's static-export rules
	node scripts/verify-static-export-routes.mjs

verify-web: lint-web typecheck-web verify-web-routing ## Lint + typecheck + routing gate for web (~30s)

test-web: ## Run web console component tests (Vitest)
	npm run test -w client-apps/web

test-a11y: ## Run the SDK workspace-panel accessibility audit (real Chromium via Vitest browser mode)
	npm run build -w @stigmer/react
	npx playwright install chromium
	npm run test:a11y -w @stigmer/react

# ─── Client Apps: Desktop (Tauri v2 + Vite + React) ──

kill-desktop: ## Kill any running Stigmer desktop dev processes
	@-pkill -f "runner/dist/main" 2>/dev/null || true
	@-pkill -f "target/debug/stigmer" 2>/dev/null || true
	@-pkill -x stigmer 2>/dev/null || true
	@-pkill -f "cargo-tauri.*dev" 2>/dev/null || true
	@-lsof -ti :5173 | xargs kill 2>/dev/null || true
	@-caddy stop 2>/dev/null || true
	@-pkill -f "grpcwebproxy.*9091" 2>/dev/null || true

launch-desktop: kill-desktop ## Start desktop app in dev mode (Tauri + Vite hot-reload)
	rm -rf client-apps/desktop/node_modules/.vite
	npm install -w desktop
	$(MAKE) build-runner
	client-apps/desktop/scripts/setup-runner-dev.sh
	client-apps/desktop/scripts/gen-dev-certs.sh
	@if command -v caddy >/dev/null 2>&1 && grep -q 'localhost:9090' client-apps/desktop/.env.development 2>/dev/null; then \
		echo "Starting local dev proxy (:9090 HTTP + :9093 HTTPS/H2)..."; \
		grpcwebproxy --backend_addr=localhost:8080 --run_tls_server=false --allow_all_origins --server_http_debug_port=9091 --server_http_max_read_timeout=120s --server_http_max_write_timeout=120s & \
		sleep 1; \
		caddy start --config client-apps/desktop/scripts/Caddyfile.dev; \
	fi
	npm run tauri dev -w desktop
	@-caddy stop 2>/dev/null || true
	@-pkill -f "grpcwebproxy.*9091" 2>/dev/null || true

build-desktop: build-runner-slim ## Build desktop native binary (requires TAURI_SIGNING_PRIVATE_KEY)
	@if [ -z "$$TAURI_SIGNING_PRIVATE_KEY" ] && [ -z "$$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then \
		echo "warning: TAURI_SIGNING_PRIVATE_KEY not set — updater artifacts will not be signed"; \
		echo "  Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH to sign builds"; \
		echo "  Key location: ~/.tauri/stigmer.key"; \
		echo ""; \
	fi
	client-apps/desktop/scripts/stage-runner-slim.sh
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

test-desktop: ## Run desktop app component tests (Vitest)
	npm run test -w desktop

test-runner-host: ## Test the stigmer-runner-host crate (+ prove the core builds without Tauri)
	cd crates/stigmer-runner-host && cargo build && cargo test

release-desktop-local: ## Debug build + install to /Applications
	$(MAKE) build-runner-slim
	client-apps/desktop/scripts/stage-runner-slim.sh
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

test-e2e: ## Run Playwright functional E2E tests against local dev server
	cd test/e2e && npm ci && npx playwright install --with-deps chromium && npx playwright test --project=functional

test-e2e-smoke: ## Run Playwright smoke tests against a deployed instance (set STIGMER_E2E_BASE_URL)
	cd test/e2e && npm ci && npx playwright install --with-deps chromium && npx playwright test --project=smoke

test-e2e-all: ## Run all Playwright E2E tests (smoke + functional)
	cd test/e2e && npm ci && npx playwright install --with-deps chromium && npx playwright test

test-e2e-approval: ## Run the deterministic HITL approval E2E (mock LLM, serial, full backend stack)
	# Install workspace deps from the ROOT (matches .github/workflows/ci.e2e.yaml).
	# `cd test/e2e && npm ci` would prune the root-hoisted packages because
	# test/e2e is a workspace member — fine in isolated CI, but it breaks a local
	# monorepo checkout. The browser fetch stays scoped to test/e2e.
	#
	# TWO invocations, two stack shapes (one Playwright run boots one stack):
	#   1. capture stack (local artifact store) — approval FLOW + disclosure
	#      specs; the gated vehicle is the shell category (writes apply-then-
	#      review there and never gate).
	#   2. file-gate stack (no artifact store) — the file-write GATE-CARD specs,
	#      the only shape where that surface exists.
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && \
		STIGMER_E2E_MOCK_LLM=1 npx playwright test --project=interactive-approval --workers=1 && \
		STIGMER_E2E_MOCK_LLM=1 STIGMER_E2E_FILE_GATES=1 npx playwright test --project=interactive-approval-gate --workers=1

# Parallel CI gate.
#
# `check` runs in two stages:
#   1. check-prep  — strictly SEQUENTIAL. Everything that mutates the working
#      tree (go mod tidy, gofmt/eslint --fix, doc generation) or builds the
#      shared artifacts that later stages consume (@stigmer libs + proto stubs).
#   2. five domain buckets run CONCURRENTLY (`make -j`). Buckets are isolated by
#      toolchain/directory so they never write to the same files:
#        check-go    — go vet/test/build + buf lint + go binaries
#        check-node  — npm typecheck/lint/build/test (web, react, sdk, desktop TS,
#                      runner, e2e specs) + tsdoc + dep hygiene
#        check-site  — vale, prettier --check, site lint/typecheck/build,
#                      demo validation, link check (all under docs/ + site/)
#        check-rust  — desktop cargo check + runner-host crate
#        check-java  — Java proto stubs + SDK (mvn)
#
# Wall-clock is now ~max(bucket) instead of the sum of every step.
JOBS ?= $(shell sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 5)

# `-Otarget` groups each bucket's output so the interleaved parallel logs stay
# readable. It requires GNU Make >= 4.0; the macOS system make is 3.81, which
# would choke on the flag, so only enable it when available.
MAKE_MAJOR := $(firstword $(subst ., ,$(MAKE_VERSION)))
OUTPUT_SYNC := $(shell test "$(MAKE_MAJOR)" -ge 4 2>/dev/null && echo -Otarget)

check: ## Run full CI gate locally (parallelized)
	$(MAKE) check-prep
	$(MAKE) -j$(JOBS) $(OUTPUT_SYNC) check-go check-node check-site check-rust check-java check-bazel
	@echo ""
	@echo "✓ check passed"

# Stage 1 — sequential prep (tree mutations + shared artifact builds).
check-prep: ## Sequential prep for check: tidy, fix, build shared libs/stubs, regenerate + verify docs
	$(MAKE) tidy
	$(MAKE) node_modules
	$(MAKE) fix
	$(MAKE) libs-build
	$(MAKE) build-ts-stubs
	$(MAKE) gen-sdk-docs
	$(MAKE) gen-sdk-docs-check
	$(MAKE) gen-ipc-fixtures
	$(MAKE) gen-ipc-fixtures-check

# Stage 2 — parallel buckets. Each bucket is internally sequential; libs + proto
# stubs are already built by check-prep, so no bucket rebuilds shared artifacts.
check-go: ## check bucket: Go vet/test/build + buf lint + binaries
	@for mod in $(GO_MODULES); do \
		echo "vet      $$mod"; \
		(cd $$mod && go vet ./...) || exit 1; \
	done
	$(MAKE) -C apis lint
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done

# Local twin of ci.bazel's required graph arm (oss#616). Build compiles and
# links every target including test binaries (catches the #596/#604 class);
# gazelle -mode=diff fails on stale BUILD files (the only detector for the
# cloud#414 class — a target that was never generated cannot fail to build).
# Tests deliberately NOT run here: check-go already runs them with -race.
check-bazel: ## check bucket: bazel graph integrity — full-graph build + BUILD-file freshness
	./bazelw build //...
	@./bazelw run //:gazelle -- -mode=diff || \
		(echo ""; echo "BUILD files are stale — fix: ./bazelw run //:gazelle, then commit."; exit 1)

check-node: ## check bucket: npm typecheck/lint/build/test (web, react, sdk, desktop, runner, demos, e2e)
	npm run typecheck -w @stigmer/sdk
	npm run lint -w @stigmer/react
	npm run typecheck -w @stigmer/react
	npm run typecheck -w @stigmer/demos
	# E2E specs typecheck against @stigmer/sdk + @stigmer/protos workspace
	# source; this catches spec/helper drift faster than the full-stack
	# ci.e2e-interactive lane (#572), which runs the interactive project.
	npm run typecheck -w @stigmer/e2e
	node scripts/verify-scenar-tours.mjs
	npm run lint -w client-apps/web
	npm run typecheck -w desktop
	npm run lint -w desktop
	npm run build -w client-apps/web
	# Runs after the web build on purpose: with a fresh out/ present, the
	# routing gate also cross-checks its derived export set against the
	# real artifact (hermetic mode elsewhere).
	node scripts/verify-static-export-routes.mjs
	npm run test -w client-apps/web
	npm run test -w desktop
	cd $(RUNNER_DIR) && npm run typecheck
	cd $(RUNNER_DIR) && npm run build
	# Boot the compiled dist with plain node: vitest/tsx interop masks
	# ESM/CJS import crashes that kill `node dist/main.js` at startup (#399).
	cd $(RUNNER_DIR) && npm run verify:dist
	cd $(RUNNER_DIR) && npm run check-deps
	cd $(SERVER_DIR) && npm run typecheck
	cd $(SERVER_DIR) && npm run build
	# Same #399-class gate for the TS server's compiled entry.
	cd $(SERVER_DIR) && npm run verify:dist
	cd sdk/ink && npm run tsdoc:check
	cd sdk/react && npm run tsdoc:check

check-site: ## check bucket: docs lint/format/links + site lint/typecheck/test/build + demo validation
	@vale sync 2>/dev/null
	@vale $(DOCS_SOURCES)
	@$(PRETTIER_GUARD)
	@$(PRETTIER) --check --prose-wrap always $(DOCS_SOURCES)
	$(MAKE) check-docs-yaml
	$(MAKE) check-docs-inventory
	$(MAKE) -C site lint
	$(MAKE) -C site typecheck
	$(MAKE) -C site test-unit
	$(MAKE) -C site build
	$(MAKE) -C site validate-demos
	@lychee --config .lychee.toml --root-dir . docs/

check-rust: ## check bucket: desktop cargo check + runner-host crate (mirrors ci.crate: fmt/clippy/build/test)
	cd client-apps/desktop/src-tauri && cargo check --quiet
	cd crates/stigmer-runner-host && cargo fmt --check
	cd crates/stigmer-runner-host && cargo clippy --all-targets -- -D warnings
	cd crates/stigmer-runner-host && cargo build && cargo test

check-java: ## check bucket: Java proto stubs + SDK (mvn)
	$(MAKE) build-java-sdk

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
	@$(PRETTIER_GUARD)
	@$(PRETTIER) --write --prose-wrap always $(DOCS_SOURCES)

format-docs-check: ## Check documentation formatting (CI, no writes)
	@$(PRETTIER_GUARD)
	@$(PRETTIER) --check --prose-wrap always $(DOCS_SOURCES)

check-docs-yaml: ## Validate every docs YAML block + raw examples/seedpack manifests against the proto contracts, incl. platform-parity protovalidate rules (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=docs-yaml-check --docs-dir docs --authoring-dirs examples,seedpack --rules=enforce

report-docs-yaml-rules: ## Full-depth protovalidate rule report over docs YAML (incl. latent platform-blind findings; never fails)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=docs-yaml-check --docs-dir docs --rules=report

check-docs-inventory: ## Verify every docs page is classified in docs/_inventory/classification.yaml (CI)
	$(MAKE) -C site check-docs-inventory

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

.PHONY: check-deps
check-deps: ## Verify runner LangChain dependency hygiene (no duplicate @langchain/core)
	@cd $(RUNNER_DIR) && npm run check-deps



# ─── Local Dev ────────────────────────────────

.PHONY: install-cli-shim
install-cli-shim: node_modules ## Install ~/bin/stigmer — a shim running the @stigmer/cli TypeScript source via tsx
	@mkdir -p $(HOME)/bin
	@# --tsconfig is required: tsx applies a tsconfig's jsx setting only to files it
	@# matches, and no per-package config covers the cross-package JSX source the CLI
	@# imports (@stigmer/ink, @stigmer/react). tsconfig.tsx.json forces the automatic
	@# JSX runtime tree-wide so those components don't fall back to classic React.createElement.
	@printf '#!/bin/sh\n# Auto-generated by `make install-cli-shim` — runs the @stigmer/cli TypeScript source via tsx.\n# --tsconfig applies jsx: react-jsx across all from-source packages (see tsconfig.tsx.json).\nexec "%s/node_modules/.bin/tsx" --tsconfig "%s/tsconfig.tsx.json" "%s/client-apps/cli/src/cli/stigmer.ts" "$$@"\n' "$(CURDIR)" "$(CURDIR)" "$(CURDIR)" > $(HOME)/bin/stigmer
	@chmod +x $(HOME)/bin/stigmer
	@echo "installed: $(HOME)/bin/stigmer  (runs the CLI from source)"
	@command -v stigmer >/dev/null 2>&1 || echo "note: add $(HOME)/bin to your PATH, then reopen your shell, to use 'stigmer'"

.PHONY: local
local: node_modules build-ts-stubs install-cli-shim build-server ## One-shot local setup: JS deps + proto stubs + a built server + a `stigmer` command
	@rm -f bin/stigmer 2>/dev/null || true
	@echo "built: the server ($(SERVER_DIR)/dist)"
	@echo ""
	@echo "Now run:"
	@echo "  stigmer up          # start the local stack"
	@echo "  stigmer --help"
	@echo ""
	@echo "Local agents run on Anthropic Claude models:"
	@echo ""
	@echo "  export ANTHROPIC_API_KEY=sk-ant-...   # or run: stigmer setup"
	@echo ""

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
	NEW_VERSION="$$MAJOR.$$MINOR.$$PATCH"; \
	PIN=$$(git show HEAD:mcp-server/Dockerfile | sed -n 's/^ARG MCP_SERVER_VERSION=//p'); \
	if [ "$$PIN" != "$$NEW_VERSION" ]; then \
		echo "error: mcp-server/Dockerfile at HEAD pins MCP_SERVER_VERSION=$$PIN but this release is $$NEW_TAG."; \
		echo "release.npm-libs will refuse to publish (prod deploys the pin, not the tag)."; \
		echo "Bump the pin and COMMIT it before tagging:"; \
		echo "  sed -i '' 's/^ARG MCP_SERVER_VERSION=.*/ARG MCP_SERVER_VERSION=$$NEW_VERSION/' mcp-server/Dockerfile"; \
		echo "  git add mcp-server/Dockerfile && git commit -m 'chore(mcp-server): bump the Dockerfile bridge pin to $$NEW_VERSION'"; \
		exit 1; \
	fi; \
	echo "$$LATEST_TAG -> $$NEW_TAG (bridge pin OK)"; \
	git tag -a "sdk/go/$$NEW_TAG" -m "Release sdk/go $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "Release $$NEW_TAG"; \
	for t in "sdk/go/$$NEW_TAG" "$$NEW_TAG"; do \
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
	@echo "  - MCP server Docker image        (release.mcp-server.yaml)"

# ─── Dev Publishing ───────────────────────────
# Publish throwaway "dev" builds to each ecosystem's native ephemeral channel so
# two developers can iterate across repos fast. See
# .github/workflows/docs/dev-publishing.md for the consumer side.

.PHONY: publish-dev
publish-dev: ## Publish dev builds via the release.dev workflow (usage: make publish-dev [targets=all] [base=X.Y.Z])
	@command -v gh >/dev/null 2>&1 || { echo "error: gh CLI not found — install from https://cli.github.com"; exit 1; }
	@set -e; \
	BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	TARGETS="$(or $(targets),all)"; \
	echo "Dispatching release.dev on branch '$$BRANCH' (targets: $$TARGETS, base: $(or $(base),auto))"; \
	gh workflow run release.dev.yaml --ref "$$BRANCH" -f targets="$$TARGETS" $(if $(base),-f base_version="$(base)",); \
	echo ""; \
	echo "Dispatched. Follow the run with:"; \
	echo "  gh run watch \$$(gh run list --workflow=release.dev.yaml --branch \"$$BRANCH\" --limit 1 --json databaseId --jq '.[0].databaseId')"

.PHONY: publish-dev-local
publish-dev-local: ## Publish dev builds from your working tree (creds from Planton; usage: make publish-dev-local [targets=all] [base=X.Y.Z])
	@TARGETS="$(or $(targets),all)" BASE="$(base)" scripts/publish-dev-local.sh

.PHONY: publish-dev-maven-local
publish-dev-maven-local: ## Local dev publish, Maven only (alias for publish-dev-local targets=maven)
	@TARGETS="maven" BASE="$(base)" scripts/publish-dev-local.sh

# ─── Clean ────────────────────────────────────

.PHONY: clean
clean: ## Remove all build artifacts
	rm -rf bin/ coverage/ coverage.txt coverage.html
	rm -rf $(SERVER_DIR)/dist/ $(SERVER_DIR)/dist-slim/
	rm -rf client-apps/web/out/ client-apps/web/.next/
	$(MAKE) -C apis clean
