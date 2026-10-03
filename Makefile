bump ?= patch

# The Go module set has one home: go.work. Every Go target below loops over
# this list, so it is derived from go.work at use time rather than kept by
# hand — the hand-kept list drifted before (four entries while go.work held
# eight), and a module missing here is a module
# no gate compiles. `go list -m` in workspace mode prints exactly the `use`
# modules; the result is made repo-relative so the per-module echo lines read
# `apis/stubs/go`, not an absolute path. Recursively expanded (`=`) on purpose:
# it is evaluated only by a target that references it, so `make help` or a
# web-only target on a machine without Go never runs `go`. When the list comes
# back empty the guard stops make with a real message instead of letting a
# `for` loop over nothing pass as green.
GO_MODULES = $(or $(patsubst $(CURDIR)/%,%,$(shell go list -m -f '{{.Dir}}' 2>/dev/null)),$(error go.work yielded no Go modules — is Go installed? run: go list -m))

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

.PHONY: build build-java-protos build-java-sdk build-runner build-runner-slim build-server protos codegen build-ts-stubs build-libs gen-narration gen-sdk-docs gen-proto-sdk-docs gen-react-sdk-docs gen-ink-sdk-docs gen-theme-docs gen-task-docs gen-task-registry gen-task-registry-check gen-sdk-docs-check gen-proto-sdk-docs-check gen-react-sdk-docs-check gen-ink-sdk-docs-check gen-theme-docs-check gen-task-docs-check gen-ipc-fixtures gen-ipc-fixtures-check stubs-internal-check gen-authorization-model gen-authorization-model-check gen-substrate-stubs gen-substrate-stubs-check
build: build-libs build-web verify-desktop docs-build build-java-sdk build-runner build-server ## Build all project artifacts
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
# file:-linked @stigmer/protos, NOT an npm workspace.
$(SERVER_DIR)/node_modules: $(SERVER_DIR)/package.json
	@echo "npm install  $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npm install
	@touch $(SERVER_DIR)/node_modules

# site/ is a yarn 4 project with its own lockfile, outside the npm workspace;
# site/Makefile's `deps` is its install. Every root target that runs a site
# script depends on this, so a fresh worktree needs no hand-run yarn install.
# Phony, not a node_modules file target: the install can rewrite site/yarn.lock
# (the file: hash note above `check`), which would leave such a target always
# stale or never.
.PHONY: site-deps
site-deps:
	$(MAKE) -C site deps

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
# per-schema copy the Go embed carried retired with the Go server.
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
# (a baseline plus ledger-derived overrides, served publicly). The bundled
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

# The authorization model: its source is the modular OpenFGA model under
# $(SERVER_DIR)/fga/model, compiled by OpenFGA's own parser into the one
# JSON file the server evaluates, the engine suites test and every edition
# applies (fga/model/README.md states the file's contract). The check
# compiles in memory and compares with the committed bytes.
AUTHZ_MODEL_DIR := $(SERVER_DIR)/fga/model
AUTHZ_MODEL_JSON := $(SERVER_DIR)/src/authorization/model/data/authorization-model.json

gen-authorization-model: ## Compile the authorization model's .fga files into the server's OpenFGA JSON
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@node_modules/.bin/tsx tools/codegen/src/authorization-model/main.ts \
		--model-dir $(AUTHZ_MODEL_DIR) --out $(AUTHZ_MODEL_JSON)

gen-authorization-model-check: ## Verify the authorization model JSON is up to date with its .fga files (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@node_modules/.bin/tsx tools/codegen/src/authorization-model/main.ts \
		--model-dir $(AUTHZ_MODEL_DIR) --out $(AUTHZ_MODEL_JSON) --check

gen-substrate-stubs: ## Generate the substrate sandbox driver's Agent Substrate API stubs (server-private, from the tag in its buf.gen.substrate.yaml)
	cd $(SERVER_DIR) && buf generate --template buf.gen.substrate.yaml -o src/sandbox/substrate

gen-substrate-stubs-check: ## Verify the committed Agent Substrate stubs match their generator config (CI)
	@tmp=$$(mktemp -d) && \
	(cd $(SERVER_DIR) && buf generate --template buf.gen.substrate.yaml -o $$tmp) && \
	if ! diff -r $$tmp/gen $(SERVER_DIR)/src/sandbox/substrate/gen > /dev/null; then \
		rm -rf $$tmp; echo "error: the Agent Substrate stubs are stale — run 'make gen-substrate-stubs'"; exit 1; \
	fi; rm -rf $$tmp

stubs-internal-check: ## Verify committed stubs carry no @internal comment sections (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@node_modules/.bin/tsx tools/codegen/src/stubscrub/main.ts -check apis/stubs sdk/go/proto

gen-react-sdk-docs: site-deps ## Generate React SDK reference docs from TypeDoc
	cd sdk/react && npm run typedoc:json
	cd site && yarn generate-react-sdk-docs

gen-ink-sdk-docs: site-deps ## Generate Ink SDK reference docs from TypeDoc
	cd sdk/ink && npm run typedoc:json
	cd site && yarn generate-ink-sdk-docs

gen-theme-docs: site-deps ## Generate theme token reference docs from tokens.css
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

gen-react-sdk-docs-check: site-deps ## Verify React SDK docs are up to date (CI)
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

gen-ink-sdk-docs-check: site-deps ## Verify Ink SDK docs are up to date (CI)
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

gen-theme-docs-check: site-deps ## Verify theme token docs are up to date (CI)
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

codegen: protos build-ts-stubs gen-sdk-docs gen-narration gen-ipc-fixtures gen-authorization-model ## Regenerate all derived code (stubs + SDK docs + narration + IPC fixtures + the authorization model JSON)

gen-ipc-fixtures: $(RUNNER_DIR)/node_modules ## Regenerate golden IPC fixtures from ipc-protocol.ts (runner artifact + crate copy)
	@cd $(RUNNER_DIR) && npm run gen:ipc-fixtures

gen-ipc-fixtures-check: $(RUNNER_DIR)/node_modules ## Verify golden IPC fixtures are fresh (CI) — fails if the contract changed without regenerating
	@cd $(RUNNER_DIR) && npm run gen:ipc-fixtures -- --check

build-ts-stubs: node_modules ## Rebuild the runner-linked workspace lib dists (@stigmer/protos after stub regeneration + @stigmer/temporal-codecs)
	npm run build:runner-deps

# Build only. The libs' unit suites are test-libs, run by `make check` and
# `make test-libs`, never as a side effect of building something that links
# the libs: the web console's export, every smoke-* target and two release
# lane jobs depend on this target, and each of them once re-ran the whole
# workspace suite (4,800+ React tests, ~5.5 min) on a commit CI had already
# tested, because the prerequisite was a build+test composite.
build-libs: node_modules ## Build the publishable workspace libs (turbo `build` over the publish set)
	npm run build:libs

# ─── Test ─────────────────────────────────────

.PHONY: test-libs
test-libs: node_modules ## Run the repo scripts' tests and the workspace libs' unit suites (`npm test`)
	npm test

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

# The live class calls real providers with the keys in your shell (each
# suite names the one it reads, through liveSecret) and spends real money; a
# suite whose key is missing skips by name. With STIGMER_LIVE=1 a missing key
# fails. The live workflow (ci.live.yaml) runs the same suites after each
# release.
.PHONY: test-live
test-live: $(RUNNER_DIR)/node_modules ## Run the runner's live suites against real providers (needs the provider keys the suites read, e.g. CURSOR_API_KEY; spends money)
	@echo "testing  $(RUNNER_DIR) (live)"
	@cd $(RUNNER_DIR) && npm run test:live

.PHONY: test-server test-authorization-model
test-server: build-ts-stubs $(SERVER_DIR)/node_modules ## Run the TypeScript server vitest suite
	@echo "testing  $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npm test

# The model author's one command: regenerate the JSON so a .fga edit is
# never tested against stale bytes, run every suite on the OpenFGA engine
# at the version production runs (the fga CLI embeds it; FGA_CLI_VERSION
# moves with production's engine, and the CI lane pins the same version by
# checksum), then run the same suites and the model's pins through the
# built-in evaluator. FGA names the CLI to use (default: fga on PATH).
FGA_CLI_VERSION := 0.7.20
FGA ?= fga
AUTHZ_MODEL_EVALUATOR_SUITES := src/authorization/__tests__/store-tests.test.ts \
	src/authorization/__tests__/wire-permissions.test.ts \
	src/authorization/model/__tests__/registry.test.ts \
	src/authorization/model/__tests__/openfga-json.test.ts

test-authorization-model: build-ts-stubs $(SERVER_DIR)/node_modules ## Regenerate the authorization model, run its suites on the OpenFGA engine (fga CLI $(FGA_CLI_VERSION)), then on the built-in evaluator
	@$(MAKE) --no-print-directory gen-authorization-model
	@fga="$$(command -v $(FGA))" || { echo "error: the fga CLI is not installed — install v$(FGA_CLI_VERSION) from https://github.com/openfga/cli/releases/tag/v$(FGA_CLI_VERSION), or set FGA"; exit 1; }; \
	case "$$fga" in /*) ;; *) fga="$$PWD/$$fga" ;; esac; \
	"$$fga" version | grep -qF 'v`$(FGA_CLI_VERSION)`' || { echo "error: fga v$(FGA_CLI_VERSION) is required (it embeds the OpenFGA version production runs); found: $$("$$fga" version)"; exit 1; }; \
	echo "engine   $(SERVER_DIR)/fga/tests (fga v$(FGA_CLI_VERSION))"; \
	cd $(SERVER_DIR) && "$$fga" model test --tests 'fga/tests/*.fga.yaml'
	@echo "evaluator $(SERVER_DIR)"
	@cd $(SERVER_DIR) && npx vitest run $(AUTHZ_MODEL_EVALUATOR_SUITES)

# The consumer compiles a fake extension against the @stigmer/server
# exports map ALONE: a missing export is a tsc failure here, not
# a review miss. Standalone package with a file: link for the fast PR-time
# proof; `npm run verify:consumer` in the server re-runs the same typecheck
# against the PACKED tarball, the shape the published consumer (the cloud
# composition, pinning @stigmer/server from npm) actually installs.
.PHONY: test-extension-consumer
test-extension-consumer: build-server ## Compile-proof the @stigmer/server library contract via test/extension-consumer
	@echo "compile-proof  test/extension-consumer (the exports-map contract)"
	@cd test/extension-consumer && npm ci --no-audit --no-fund && npm run typecheck

# ─── Conformance Test (gRPC API contract) ─────
# The conformance suite (test/conformance, @stigmer/conformance) is the one
# integration instrument: a TypeScript/vitest workspace that builds the OSS
# server from source and drives it through generated Connect clients — the
# shared contract that turns OSS<->cloud behavioral drift into a failing
# test, and (since stigmer#1022) the home of the runner-behavior arms the Go
# test/integration* suites used to hold before they retired with the Java
# service. The two slices are deliberately separate: the
# dependency-light CRUD signal stays fast, while execution additionally needs
# the `temporal` and `stigmer` CLIs, git, and a runner build. See
# test/conformance/README.md.

.PHONY: test-conformance
test-conformance: build-ts-stubs ## Run gRPC conformance CRUD suite (local; builds the server from source, no Temporal)
	@echo "=== conformance: CRUD contract (local) ==="
	CONFORMANCE_TARGET=local npm run test -w @stigmer/conformance

.PHONY: test-conformance-single-org
test-conformance-single-org: build-ts-stubs ## Run the single-organization conformance suite against the shipped entry (local-single-org: the open-source edition holds one organization)
	@echo "=== conformance: the open-source edition's one organization (local-single-org) ==="
	CONFORMANCE_TARGET=local-single-org npm run test -w @stigmer/conformance -- src/suites/single-organization.conformance.test.ts

.PHONY: test-conformance-execution
test-conformance-execution: build-runner ## Run gRPC conformance execution suite (local-execution; needs the `temporal` and `stigmer` CLIs)
	@command -v temporal >/dev/null 2>&1 || { \
		echo "error: temporal CLI not found — the dev server backs the execution harness"; \
		echo "  install: make install-temporal-cli   (writes ~/bin/temporal, the version stigmer up runs)"; \
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

# The live harness benchmark is an EXPERIMENT, not a test: it drives both
# harnesses against real providers and spends real money. It is in no vitest
# config. No `stigmer` CLI check here, unlike the execution suites: the
# benchmark's own planner refuses, by name in the report, every cell on the
# working agent (whose memory spawns `stigmer mcp-server`) when the CLI is
# not on PATH, and runs the rest; the check lives there so `npm run` refuses
# the same way. Flags pass through BENCHMARK_ARGS
# (e.g. BENCHMARK_ARGS="--reps 3 --only native").
.PHONY: benchmark-harnesses
benchmark-harnesses: build-runner ## Measure the native and Cursor harnesses on real providers and write the internal benchmark report (needs the `temporal` and `stigmer` CLIs, ANTHROPIC_API_KEY, CURSOR_API_KEY; spends money)
	@command -v temporal >/dev/null 2>&1 || { \
		echo "error: temporal CLI not found — the dev server backs the benchmark stack"; \
		echo "  install: make install-temporal-cli   (writes ~/bin/temporal, the version stigmer up runs)"; \
		exit 1; \
	}
	@echo "=== benchmark: native vs cursor on real providers (an experiment, not a test) ==="
	npm run benchmark:harnesses -w @stigmer/conformance -- $(BENCHMARK_ARGS)

.PHONY: postgres-dev
postgres-dev: ## Start a throwaway Postgres 16 for the postgres targets (docker; port 55432)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the postgres targets need a real Postgres"; exit 1; }
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
		echo "  install: make install-temporal-cli   (writes ~/bin/temporal, the version stigmer up runs)"; \
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
# console's static export into the artifact and loud-fails
# without a built client-apps/web/out.
.PHONY: smoke-cli-cutover
smoke-cli-cutover: build-runner build-server build-web ## Run the CLI E2E smoke: `stigmer up` against the packaged slim server artifact (needs `temporal` on PATH for speed)
	@command -v node >/dev/null 2>&1 || { echo "error: node not found"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs
	node test/install/smoke-cli-cutover.mjs

# The bundle targets linux for THIS machine's arch (the docker daemon's
# native platform), not the host OS — the smoke builds a linux container.
.PHONY: smoke-docker-image
smoke-docker-image: build-server build-web ## Build the server Docker image from a fresh slim bundle and boot-smoke it (needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the image smoke needs a Docker daemon"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs --platform=linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")
	@cd $(SERVER_DIR) && node scripts/smoke-docker-image.mjs

# The all-in-one evaluation image: stage every package the image
# bakes from THIS checkout (scripts/stage-all-in-one.mjs — the workspace
# tarballs, the slim server and runner packages for this arch, the verified
# Temporal binary), build deploy/all-in-one natively, and run the one smoke
# the PR gate (ci.all-in-one.yaml) and the release lane run. Needs Docker;
# builds a linux image for the docker daemon's native arch.
.PHONY: smoke-all-in-one
smoke-all-in-one: build-runner build-server build-web ## Stage, build and boot-smoke the all-in-one evaluation image (needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the all-in-one smoke needs a Docker daemon"; exit 1; }
	node scripts/stage-all-in-one.mjs
	node test/install/smoke-all-in-one.mjs

# The compose-runner image's CLI (Dockerfile.sandbox, the compose-runner
# stage): @stigmer/cli and its @stigmer/* closure packed from THIS checkout
# into backend/services/runner/stage/cli, which the stage COPYs and installs.
# The release lane stages the same way (--version <release>) and hands the
# result to the image jobs as an artifact; here it is the input every
# source build of the compose runner needs (stigmer/stigmer#1158).
.PHONY: stage-compose-runner-cli
stage-compose-runner-cli: build-libs ## Stage the CLI tarballs the compose-runner image installs (from this checkout, dev version)
	node scripts/stage-compose-runner-cli.mjs --skip-build

# The @stigmer/server library as a consumer installs it: the server and the
# @stigmer/* closure of its file: links, packed from THIS checkout at one
# 0.0.0-local.<stamp> version into backend/services/stigmer-server/stage/library
# (scripts/stage-server-library.mjs; out=<dir> moves it). A consumer that
# pins the library installs the set with `npm install --no-save` and runs its
# own suite against an unreleased server change, with nothing published. The
# script builds the stubs, the linked libs and the server first.
.PHONY: stage-server-library
stage-server-library: node_modules ## Stage @stigmer/server and its @stigmer/* libs as tarballs from this checkout, no registry (out=<dir>)
	node scripts/stage-server-library.mjs $(if $(out),--out=$(out))

# The compose gate: build both images from source and
# prove the full self-host stack — server + Postgres + Temporal + runner —
# up to one end-to-end workflow run. The same script the PR gate
# (ci.compose-stack.yaml) and the release lane run. Fixed ports 7234/7235:
# stop any running `stigmer up` first.
.PHONY: smoke-compose
smoke-compose: build-server build-web stage-compose-runner-cli ## Build the compose stack from source and run the clean-clone gate smoke (needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the compose smoke needs a Docker daemon"; exit 1; }
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs --platform=linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")
	node test/install/smoke-compose.mjs --build

# The Helm chart (deploy/helm/stigmer):
# docker-compose.yml translated for Kubernetes. Three gates, the compose
# stack's shape: lint-helm is the static pass (helm lint --strict and
# kubeconform on every CI values profile), test-helm the render tests
# (goldens, the compose-parity test, the schema refusals — also in the root
# test:scripts lane), smoke-helm the kind install with the same probes as
# smoke-compose plus the adversarial arms, from source-built images (the
# release lane runs the same script against the pushed tags).
HELM_CHART_DIR := deploy/helm/stigmer
HELM_PROFILES := bundled byo ingress-oidc
# The floor Chart.yaml declares (native gRPC probes are GA in 1.27).
HELM_KUBE_VERSION := 1.27.0

.PHONY: lint-helm
lint-helm: ## Lint the Helm chart on every CI values profile and validate its render against the Kubernetes schemas (needs helm, kubeconform)
	@command -v helm >/dev/null 2>&1 || { echo "error: helm not found"; exit 1; }
	@command -v kubeconform >/dev/null 2>&1 || { echo "error: kubeconform not found — https://github.com/yannh/kubeconform"; exit 1; }
	@for profile in $(HELM_PROFILES); do \
		echo "helm lint --strict ($$profile)"; \
		helm lint --strict $(HELM_CHART_DIR) -f $(HELM_CHART_DIR)/ci/values-$$profile.yaml --quiet || exit 1; \
		echo "kubeconform ($$profile)"; \
		helm template stigmer $(HELM_CHART_DIR) -f $(HELM_CHART_DIR)/ci/values-$$profile.yaml \
			| kubeconform -strict -kubernetes-version $(HELM_KUBE_VERSION) -summary || exit 1; \
	done

# zizmor, the workflow auditor; the workflows lane (.github/workflows/ci.workflows.yaml)
# pins the same version, so a local run and the lane judge alike.
ZIZMOR_VERSION := 1.30.1

.PHONY: lint-workflows
lint-workflows: ## Audit .github with zizmor, as the workflows lane does (needs uv; the online audits need gh signed in)
	@command -v uvx >/dev/null 2>&1 || { echo "error: uvx not found — https://docs.astral.sh/uv/"; exit 1; }
	@if token=$$(gh auth token 2>/dev/null) && [ -n "$$token" ]; then \
		GH_TOKEN=$$token uvx zizmor==$(ZIZMOR_VERSION) .github; \
	else \
		echo "lint-workflows: gh is not signed in, so only the offline audits run (the workflows lane runs them all)"; \
		uvx zizmor==$(ZIZMOR_VERSION) --offline .github; \
	fi

.PHONY: test-helm
test-helm: node_modules ## Run the chart's render, compose-parity and schema tests (needs helm)
	node --test $(HELM_CHART_DIR)/__tests__/*.test.mjs

.PHONY: smoke-helm
smoke-helm: build-server build-web stage-compose-runner-cli ## Build both images from source, install the chart on kind and run the gate smoke (needs Docker, kind, helm, kubectl)
	@for tool in docker kind helm kubectl; do command -v $$tool >/dev/null 2>&1 || { echo "error: $$tool not found — the Helm smoke needs it"; exit 1; }; done
	@cd $(SERVER_DIR) && node scripts/bundle-slim.mjs --platform=linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")
	node test/install/smoke-helm.mjs --build

# The upgrade rehearsal (test/install/rehearse-upgrade.mjs): one install moved from
# the newest published release to THIS checkout by the procedure its guide
# gives a user, then proven to have kept what the old release stored. Each
# target builds what its artifact's smoke builds, stamped with the checkout's
# from-source version (scripts/lib/source-version.mjs), so the rehearsal can
# require the upgraded server to report exactly that. REHEARSE_ARGS passes
# through, e.g. REHEARSE_ARGS=--from=3.38.3. compose, helm and cli bind port
# 7234: stop any running stack first.
SOURCE_BUILD_VERSION = $$(node $(CURDIR)/scripts/lib/source-version.mjs)
LINUX_SLIM_PLATFORM = linux-$$(node -e "process.stdout.write(process.arch==='x64'?'x64':'arm64')")

.PHONY: rehearse-upgrade
rehearse-upgrade: ## Rehearse an upgrade from the last release to this checkout: ARTIFACT=compose|all-in-one|helm|cli [REHEARSE_ARGS=--from=X.Y.Z]
	@test -n "$(ARTIFACT)" || { echo "error: set ARTIFACT=compose|all-in-one|helm|cli"; exit 1; }
	$(MAKE) rehearse-upgrade-$(ARTIFACT)

.PHONY: rehearse-upgrade-compose
rehearse-upgrade-compose: build-server build-web stage-compose-runner-cli ## Rehearse the compose stack's upgrade from the last release to this checkout (needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the compose rehearsal needs a Docker daemon"; exit 1; }
	@cd $(SERVER_DIR) && STIGMER_SERVER_VERSION=$(SOURCE_BUILD_VERSION) node scripts/bundle-slim.mjs --platform=$(LINUX_SLIM_PLATFORM)
	node test/install/rehearse-upgrade.mjs --artifact=compose $(REHEARSE_ARGS)

.PHONY: rehearse-upgrade-all-in-one
rehearse-upgrade-all-in-one: build-runner build-server build-web ## Rehearse the all-in-one image's upgrade from the last release to this checkout (needs Docker)
	@command -v docker >/dev/null 2>&1 || { echo "error: docker not found — the all-in-one rehearsal needs a Docker daemon"; exit 1; }
	node scripts/stage-all-in-one.mjs
	node test/install/rehearse-upgrade.mjs --artifact=all-in-one $(REHEARSE_ARGS)

.PHONY: rehearse-upgrade-helm
rehearse-upgrade-helm: build-server build-web stage-compose-runner-cli ## Rehearse the Helm chart's upgrade from the last release to this checkout on kind (needs Docker, kind, helm, kubectl)
	@for tool in docker kind helm kubectl; do command -v $$tool >/dev/null 2>&1 || { echo "error: $$tool not found — the Helm rehearsal needs it"; exit 1; }; done
	@cd $(SERVER_DIR) && STIGMER_SERVER_VERSION=$(SOURCE_BUILD_VERSION) node scripts/bundle-slim.mjs --platform=$(LINUX_SLIM_PLATFORM)
	node test/install/rehearse-upgrade.mjs --artifact=helm $(REHEARSE_ARGS)

.PHONY: rehearse-upgrade-cli
rehearse-upgrade-cli: build-runner build-server build-web ## Rehearse the CLI's `stigmer up` upgrade from the last release to this checkout
	@cd $(SERVER_DIR) && STIGMER_SERVER_VERSION=$(SOURCE_BUILD_VERSION) node scripts/bundle-slim.mjs
	node test/install/rehearse-upgrade.mjs --artifact=cli $(REHEARSE_ARGS)

# The `cloud` conformance targets have no target this repository can boot:
# the cloud edition is the TypeScript composition in the private stigmer-cloud
# repository (the Java stigmer-service the hermetic launcher booted retired on
# 2026-09-10). The cloud readout runs FROM stigmer-cloud — its spike boots the
# composition and sets the STIGMER_CONFORMANCE_CLOUD_* contract before running
# `npm run test:cloud -w @stigmer/conformance` here (test/conformance/README.md).
.PHONY: test-conformance-cloud
test-conformance-cloud: build-ts-stubs ## Run the Class A cloud suite against a PRE-PROVISIONED composition (STIGMER_CONFORMANCE_CLOUD_* set by the stigmer-cloud readout recipe)
	@test -n "$$STIGMER_CONFORMANCE_CLOUD_ADDRESS" || { echo "error: STIGMER_CONFORMANCE_CLOUD_ADDRESS unset — the cloud target is provisioned by stigmer-cloud's readout recipe (backend/services/stigmer-server/spike/README.md), not booted here"; exit 1; }
	npm run test:cloud -w @stigmer/conformance

.PHONY: test-conformance-all
test-conformance-all: ## Run both conformance slices (CRUD + execution)
	$(MAKE) test-conformance
	$(MAKE) test-conformance-execution
	@echo "Conformance suite complete (local + local-execution)."

.PHONY: test-replay
test-replay: ## Run Temporal workflow replay determinism tests (fast, no infra needed)
	@echo "test-replay: workflow-runner has been removed (unified into runner)"

# ─── Plugin Catalogue Testing ────────────────

.PHONY: test-plugins-static audit-plugins sync-plugins

# The official plugin marketplace (plugins/) read through
# @stigmer/plugin-package, the reader the CLI and the server use: the
# marketplace file, the pin file, the notice and the tree agree, every
# offered plugin installs under its own name.
# Deterministic, network-free; runs on every plugins/** PR. The typecheck
# covers the catalogue's own tooling (plugins/scripts) and the suite; a
# script nobody typechecks is a gate nobody hears. The build stages the
# package and asks npm what it would publish, so a vendored file npm would
# drop fails here rather than at the release. Structural validity of the
# ai.stigmer/ overlays against the contract is check-docs-yaml's job
# (authoring dir `plugins`).
test-plugins-static: ## Run the plugin catalogue's static suite (fast, no network)
	@npm run build -w @stigmer/plugin-package -w @stigmer/outbound --silent
	npm run typecheck -w @stigmer/plugins
	npm run test -w @stigmer/plugins
	npm run build -w @stigmer/plugins

# The vendor-catalogue audit (plugins/scripts/audit): reads the vendors'
# marketplaces named in plugins/vendor.json at their default branch (or a
# pinned commit) through the product's own preparation chain, probes every
# hosted MCP server unauthenticated, applies the inclusion rubric from
# plugins/README.md, and writes the report a maintainer rules on. Network;
# run by hand when the catalogue is curated and by the weekly refresh lane,
# never in a test. Arguments after `--` reach the script (`--out <dir>`
# required; `--ref owner/repo=<sha>` reproduces a past report).
audit-plugins: ## Audit the vendor catalogues against the inclusion rubric (network; ARGS="--out <dir>")
	@npm run build -w @stigmer/plugin-package -w @stigmer/outbound --silent
	npm run audit -w @stigmer/plugins -- $(ARGS)

# The catalogue sync (plugins/scripts/sync): makes the tree agree with
# plugins/vendor.json, copying every pinned folder from its source at its
# commit byte for byte and rewriting NOTICE and marketplace.json's plugin
# list. With `--from-audit <audit.json>` it first rewrites the pins from an
# audit's verdicts (minus the strikes, plus any `--strike source/name=reason`).
# Network through `git` alone; a second run is a no-op.
sync-plugins: ## Sync the catalogue's vendored folders with plugins/vendor.json (git; ARGS="--from-audit <audit.json>")
	@npm run build -w @stigmer/plugin-package --silent
	npm run sync -w @stigmer/plugins -- $(ARGS)


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
       lint-docs lint-docs-audit format-docs format-docs-check check-links web-build validate-demos tsdoc-check test-demos \
       check-docs-inventory check-conformance-inventory \
       test-web test-desktop test-runner-host test-e2e test-e2e-approval test-e2e-console-login test-e2e-single-org test-a11y check check-all \
       check-prep check-go check-node check-site check-rust check-java
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

# ─── Client Apps: Web (Next.js) ──────────────

run-web: ## Start web console dev server (Vite/Next)
	npm run dev -w client-apps/web

# build-libs, not the libs' tests: the export needs the built libs (the
# embed loader is copied from sdk/embed/dist), nothing more. The export
# itself runs as the `web#build` Turbo task (turbo.json says why out/ and
# .next/ are its outputs), through the same door as build:libs, so a second
# build over unchanged inputs is a replay, locally and in the PR lanes
# (.github/workflows/ci.turbo-cache.yaml). build-libs stays a prerequisite:
# the smoke-* targets stage every lib's dist, not only the console's.
build-web: build-libs ## Build web console for production
	npm run build:web

clean-web: ## Remove web build artifacts
	rm -rf client-apps/web/out client-apps/web/.next

clean-build-web: clean-web build-web ## Clean + build web console

lint-web: ## Lint web console and React SDK
	npm run lint -w @stigmer/react
	npm run lint -w client-apps/web

typecheck-web: ## Typecheck web console, SDK, and React SDK
	npm run typecheck -w @stigmer/sdk
	npm run typecheck -w @stigmer/react
	npm run typecheck -w client-apps/web

verify-web-routing: ## Verify every web route resolves through nginx.conf's static-export rules
	node scripts/verify-static-export-routes.mjs

verify-web: lint-web typecheck-web verify-web-routing test-web ## Lint, typecheck, routing gate and component tests for web

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

# Its own target so the CI lane can run the Rust check alone: lint and
# typecheck reach it there as turbo tasks over the affected packages.
# tauri-build refuses a bundle resource path that does not exist, and
# resources/runner and resources/runtime are gitignored (setup-runner-dev.sh
# links the runner and stages the runtime, the release stages both). A
# type-check reads none of their contents, so a clean checkout gets empty
# directories, which the scripts replace.
check-desktop-rust: ## Type-check the Tauri shell's Rust crate
	cd client-apps/desktop/src-tauri && \
		{ test -e resources/runner || mkdir -p resources/runner; } && \
		{ test -e resources/runtime || mkdir -p resources/runtime; } && \
		cargo check --quiet

# The Tauri shell's own Rust tests (deep links, the auth callback parser, the
# workspace commands), with the same resource-directory preamble as the check
# above. The runner host crate's tests are `make test-runner-host`.
test-desktop-rust: ## Run the Tauri shell's Rust tests
	cd client-apps/desktop/src-tauri && \
		{ test -e resources/runner || mkdir -p resources/runner; } && \
		{ test -e resources/runtime || mkdir -p resources/runtime; } && \
		cargo test --quiet

verify-desktop: lint-desktop typecheck-desktop check-desktop-rust test-desktop test-desktop-rust ## Lint, typecheck and test desktop (TS + Rust)

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
	node scripts/turbo-set.mjs workspace tsdoc:check

test-demos: docs-build ## Run Playwright demo e2e tests — slow (~20 min), run explicitly or in CI
	$(MAKE) -C site test-demos

# The three targets below install from the ROOT for test-e2e-approval's
# reason: `cd test/e2e && npm ci` prunes the root-hoisted packages of a local
# monorepo checkout, because test/e2e is a workspace member.
test-e2e: ## Run Playwright functional E2E tests (boots a fresh local stack unless one listens on :7234)
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && npx playwright test --project=functional

test-e2e-smoke: ## Run Playwright smoke tests against a deployed instance (set STIGMER_E2E_BASE_URL)
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && npx playwright test --project=smoke

test-e2e-all: ## Run all Playwright E2E tests (smoke + functional)
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && npx playwright test

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

test-e2e-oauth-mcp: ## Run the plugin journey's sign-in arm against a hosted OAuth MCP fixture (fresh stack, the console's callback as redirect)
	# One stack shape of its own: the conformance harness's OAuth MCP server
	# and login server as one process (oauth-mcp-fixture-main.ts), the
	# server booted with STIGMER_OAUTH_REDIRECT_URI at the web dev server's
	# callback page, so the journey signs in through a real popup. A running
	# backend on the API port is refused by the global setup.
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && STIGMER_E2E_OAUTH_MCP=1 npx playwright test --project=functional plugin-install-journey

test-e2e-console-login: ## Run the console sign-in E2E against a server in the OIDC posture (hermetic issuer, serial)
	# One stack shape of its own: test/support's local OIDC issuer
	# (local-oidc-issuer-main.ts) as a process, the server booted
	# with STIGMER_OIDC_ISSUER pointed at it, `next dev` in OIDC mode with the
	# same coordinates (test/e2e/fixtures/oidc.ts). Root install for the same
	# reason as test-e2e-approval; needs the built server and runner.
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && \
		STIGMER_E2E_OIDC=1 npx playwright test --project=console-login --workers=1

test-e2e-single-org: ## Run the console E2E against the shipped server entry, which holds one organization (the open-source edition as a laptop runs it)
	# One stack shape of its own: the shipped entry in the trusted-local
	# posture with nothing seeded (test/e2e/fixtures/single-org.ts); every
	# other project boots the library entry, which holds several. Root install
	# for the same reason as test-e2e-approval; needs the built server and runner.
	npm ci
	cd test/e2e && npx playwright install --with-deps chromium && \
		STIGMER_E2E_SINGLE_ORG=1 npx playwright test --project=single-org

# Parallel CI gate.
#
# `check` runs in two stages:
#   1. check-prep  — strictly SEQUENTIAL. Everything that mutates the working
#      tree (go mod tidy, gofmt/eslint --fix, doc generation) or builds the
#      shared artifacts that later stages consume (@stigmer libs + proto stubs).
#   2. five domain buckets run CONCURRENTLY (`make -j`). Buckets are isolated by
#      toolchain/directory so they never write to the same files:
#        check-go    — go vet/test/build + buf lint + go binaries
#        check-node  — the ci.ts-workspace lane's typecheck/lint/tsdoc and
#                      web+desktop suites over the whole workspace, then the
#                      runner and server builds + dep hygiene
#        check-site  — vale, prettier --check, site lint/typecheck/build,
#                      demo validation, link check (all under docs/ + site/)
#        check-rust  — desktop cargo test + runner-host crate
#        check-java  — Java proto stubs + SDK (mvn)
#
# After `make setup` once, `make check` needs nothing else, in a fresh worktree
# too: each bucket depends on the installs it reads (the standalone server's
# node_modules, site/'s yarn install, the Tauri shell's resource directories).
# That site install can leave site/yarn.lock modified: yarn records a content
# hash of each file:-linked @stigmer lib, and the hash follows the lib's built
# dist, so it moves whenever a lib differs from the build last committed.
# Every install of it is non-immutable, so a stale hash fails nothing; what a
# branch should do with the rewrite is stigmer/stigmer#1193.
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
	$(MAKE) -j$(JOBS) $(OUTPUT_SYNC) check-go check-node check-site check-rust check-java
	@echo ""
	@echo "✓ check passed"

# Stage 1 — sequential prep (tree mutations + shared artifact builds). The
# workspace libs' unit suites run here, before the parallel buckets, on
# purpose: the React suite alone is ~4 minutes of vitest workers, and it
# should not compete with the cargo, Maven and site builds of stage 2.
check-prep: ## Sequential prep for check: tidy, fix, build + test shared libs, build stubs, regenerate + verify docs
	$(MAKE) tidy
	$(MAKE) node_modules
	$(MAKE) fix
	$(MAKE) build-libs
	# The lane's libs job order: build, the Node-ESM gate over the dists, tests.
	node scripts/verify-esm-node.mjs
	$(MAKE) test-libs
	$(MAKE) build-ts-stubs
	$(MAKE) gen-sdk-docs
	$(MAKE) gen-sdk-docs-check
	$(MAKE) gen-ipc-fixtures
	$(MAKE) gen-ipc-fixtures-check
	$(MAKE) gen-authorization-model-check
	$(MAKE) agents-sync
	$(MAKE) agents-check

# Stage 2 — parallel buckets. Each bucket is internally sequential; libs + proto
# stubs are already built by check-prep, so no bucket rebuilds shared artifacts.
# check-node's turbo tasks still reach `^build`, as cache hits on check-prep's
# builds, and a hit leaves outputs already on disk untouched (measured on turbo
# 2.10.12: same inode and mtime; only a missing output is restored), so the
# site bucket reading those dists through its file: links sees no rewrite.
# The Go compile gate. `go build ./...` per module is what `bazelw build //...`
# used to be before Bazel's retirement (oss#616's graph arm): it
# compiles and links every package, so a committed stub that no other module
# imports (apis/stubs/go has no tests and sdk/go reaches none of it) still
# fails here and in ci.go-sdk instead of on a consumer's machine. vet then
# type-checks the test files build does not link.
check-go: ## check bucket: Go build/vet/test over every go.work module + buf lint
	@for mod in $(GO_MODULES); do \
		echo "build    $$mod"; \
		(cd $$mod && go build ./...) || exit 1; \
	done
	@for mod in $(GO_MODULES); do \
		echo "vet      $$mod"; \
		(cd $$mod && go vet ./...) || exit 1; \
	done
	$(MAKE) -C apis lint
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done

# The workspace half is the ci.ts-workspace lane's own calls, through the same
# wrapper, over the whole set where the lane takes the affected slice: a member
# added to the root `workspaces` list is checked here with no edit, and
# scripts/check-node-parity.test.mjs fails when the lane gains a call this gate
# does not make. The lane's browser-mode suite (test:a11y, a real Chromium) is
# the one call left to CI. The runner and server lines are their own lanes'.
check-node: $(SERVER_DIR)/node_modules ## check bucket: the TS workspace lane (typecheck, lint, tsdoc, web + desktop suites) + runner + server
	node scripts/turbo-set.mjs workspace typecheck
	node scripts/turbo-set.mjs workspace lint
	node scripts/turbo-set.mjs workspace tsdoc:check
	# The cloud-capability behavior inventory: every conformance
	# row has a test, every test tag names a row. Static — no target boots.
	$(MAKE) check-conformance-inventory
	node scripts/verify-scenar-tours.mjs
	npm run build:web
	# Runs after the web build on purpose: with a fresh out/ present, the
	# routing gate also cross-checks its derived export set against the
	# real artifact (hermetic mode elsewhere).
	$(MAKE) verify-web-routing
	node scripts/turbo-set.mjs workspace test --only=web
	node scripts/turbo-set.mjs workspace test --only=desktop
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

check-rust: ## check bucket: desktop cargo test + runner-host crate (mirrors ci.crate: fmt/clippy/build/test)
	$(MAKE) test-desktop-rust
	cd crates/stigmer-runner-host && cargo fmt --check
	cd crates/stigmer-runner-host && cargo clippy --all-targets -- -D warnings
	cd crates/stigmer-runner-host && cargo build && cargo test

check-java: ## check bucket: Java proto stubs + SDK (mvn)
	$(MAKE) build-java-sdk

check-all: check test-demos ## Full CI gate including Playwright demo e2e (slow)

# ─── Docs Linting ─────────────────────────────

# Every docs page, and nothing else: docs/AGENTS.md is a package guide owned by
# GUIDANCE_SOURCES below, and Vale's Stigmer vocabulary (Agent, Skill) would
# fight prose that is about coding agents and repo skills.
DOCS_SOURCES = $(shell find docs -path docs/_archive -prune -o \( -name '*.md' -o -name '*.mdx' \) -not -name AGENTS.md -print)

# Agent guidance (root AGENTS.md, nested package guides, .agents/**). The
# script is the one definition of which files count, so formatting and the
# gate never disagree about the set. Vale stays on docs/: guidance is
# maintainer prose, not user documentation.
GUIDANCE_SOURCES = $(shell node scripts/agents-check.mjs --list)

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

format-docs: ## Format documentation and agent guidance with Prettier
	@$(PRETTIER_GUARD)
	@$(PRETTIER) --write --prose-wrap always $(DOCS_SOURCES) $(GUIDANCE_SOURCES)

format-docs-check: ## Check documentation and agent guidance formatting (CI, no writes)
	@$(PRETTIER_GUARD)
	@$(PRETTIER) --check --prose-wrap always $(DOCS_SOURCES) $(GUIDANCE_SOURCES)

# ─── Agent Guidance ─────────────────────────────
# Root AGENTS.md, nested <package>/AGENTS.md guides and .agents/** are the
# repo-owned source of truth for coding agents (.agents/README.md). Cursor
# attaches a nested guide only through a glob rule that names it, so every
# guide has a generated shim in .cursor/rules/agents-*.mdc. The shims are
# committed generated artifacts, like the stubs: regenerate, never edit.

.PHONY: agents-sync agents-check

agents-sync: ## Regenerate the Cursor shims (.cursor/rules/agents-*.mdc) from every nested AGENTS.md and the hook config (.cursor/hooks.json)
	@node scripts/agents-check.mjs --sync

agents-check: ## Verify agent guidance: shims and hooks.json in sync, every cited path resolves, no private-record ids (CI)
	@node scripts/agents-check.mjs

check-docs-yaml: ## Validate every docs YAML block + raw examples/plugins manifests against the proto contracts, incl. platform-parity protovalidate rules (CI)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=docs-yaml-check --docs-dir docs --authoring-dirs examples,plugins --rules=enforce

report-docs-yaml-rules: ## Full-depth protovalidate rule report over docs YAML (incl. latent platform-blind findings; never fails)
	@test -x node_modules/.bin/tsx || { echo "error: node_modules/.bin/tsx not found — run 'npm install' at the repo root"; exit 1; }
	@npm run build -w @stigmer/protos --silent
	@node_modules/.bin/tsx tools/codegen/src/generator/main.ts --target=docs-yaml-check --docs-dir docs --rules=report

check-docs-inventory: ## Verify every docs page is classified in docs/_inventory/classification.yaml (CI)
	$(MAKE) -C site check-docs-inventory

check-conformance-inventory: ## Verify every conformance row of test/conformance/inventory/cloud-capabilities.yaml has a test and every tag names a row, and run the conformance and test-support unit tests (CI)
	npm run inventory:check -w @stigmer/conformance
	npm run test:unit -w @stigmer/conformance
	npm test -w @stigmer/test-support

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
	@# Each line is one printf argument with its paths spelled $(CURDIR)/..., so
	@# scripts/lane-triggers.test.mjs reads which source the shim runs.
	@printf '%s\n' '#!/bin/sh' '# Auto-generated by `make install-cli-shim` — runs the @stigmer/cli TypeScript source via tsx.' '# --tsconfig applies jsx: react-jsx across all from-source packages (see tsconfig.tsx.json).' 'exec "$(CURDIR)/node_modules/.bin/tsx" --tsconfig "$(CURDIR)/tsconfig.tsx.json" "$(CURDIR)/client-apps/cli/src/cli/stigmer.ts" "$$@"' > $(HOME)/bin/stigmer
	@chmod +x $(HOME)/bin/stigmer
	@echo "installed: $(HOME)/bin/stigmer  (runs the CLI from source)"
	@command -v stigmer >/dev/null 2>&1 || echo "note: add $(HOME)/bin to your PATH, then reopen your shell, to use 'stigmer'"

.PHONY: install-temporal-cli
install-temporal-cli: node_modules ## Install ~/bin/temporal — the pinned, checksum-verified Temporal CLI `stigmer up` runs
	@mkdir -p $(HOME)/bin
	@# The product's own downloader (client-apps/cli/src/local/temporal/download.ts), run from
	@# source: the version pin, the checksums.txt verification and the retry are the ones
	@# `stigmer up` uses. CI runs this same script through .github/actions/temporal-cli, so a laptop
	@# and a lane run the same Temporal.
	@"$(CURDIR)/node_modules/.bin/tsx" "$(CURDIR)/client-apps/cli/scripts/install-temporal-cli.ts" --bin-dir "$(HOME)/bin"
	@command -v temporal >/dev/null 2>&1 || echo "note: add $(HOME)/bin to your PATH, then reopen your shell, to use 'temporal'"

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

gen-llms: site-deps ## Generate LLM-friendly output (llms.txt, llms-full.txt, per-page .md)
	cd site && yarn generate-llms

# ─── Release ──────────────────────────────────

.PHONY: release release-pins release-preflight
# A release hold is a file, not a memory. RELEASE_HOLD.md at the root names a
# change that is merged on main but must not ship until another has merged
# too; while it exists nothing tags, and the maintainer who lands the awaited
# change deletes the file in that same pull request. Both routes to a tag run
# this: `make release` depends on it, and the release procedure the coding
# agents follow (.agents/skills/release-stigmer-oss) runs it as its first step,
# because that procedure tags by hand to carry release notes.
release-preflight: ## Refuse to release while RELEASE_HOLD.md exists at the repository root
	@if [ -f RELEASE_HOLD.md ]; then \
		echo "error: a release hold is in force (RELEASE_HOLD.md); nothing tags until it is lifted:"; \
		echo ""; \
		cat RELEASE_HOLD.md; \
		exit 1; \
	fi
	@echo "release preflight OK: no hold"

# The five release pins travel in the commit the tag is cut from: the
# mcp-server bridge pin (release.npm-libs refuses to publish on a mismatch),
# the compose stack pin in docker-compose.yml + .env.example (the release
# lane cannot push the bump to the protected main — GH006 on v3.14.0 and
# v3.14.1 — so it moved here, next to the pin it already required), the
# Helm chart's Chart.yaml (version == appVersion; the chart's image tags
# default to v<appVersion>, and release.npm-libs refuses to package on a
# mismatch), and the two upgrade examples on the self-hosting operations
# page (the version a reader copies into .env and into `helm upgrade
# --version`; a literal nothing owned went stale at v3.14.0 while the stack
# was at v3.16.0). `make release` refuses to tag until all five name the new
# version. perl, not sed -i: the recipe must run the same on macOS and
# Linux.
release-pins: ## Bump the release pins to version=X.Y.Z (mcp-server bridge, compose stack, Helm chart, operations page); commit before `make release`
	@[ -n "$(version)" ] || { echo "usage: make release-pins version=X.Y.Z"; exit 1; }
	@echo "$(version)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "error: version must be X.Y.Z (got '$(version)')"; exit 1; }
	@perl -pi -e 's/^ARG MCP_SERVER_VERSION=.*/ARG MCP_SERVER_VERSION=$(version)/' mcp-server/Dockerfile
	@perl -pi -e 's/STIGMER_VERSION:-v[0-9A-Za-z.+-]+/STIGMER_VERSION:-v$(version)/g' docker-compose.yml
	@perl -pi -e 's/^#STIGMER_VERSION=.*/#STIGMER_VERSION=v$(version)/' .env.example
	@perl -pi -e 's/^version: .*/version: $(version)/; s/^appVersion: .*/appVersion: "$(version)"/' deploy/helm/stigmer/Chart.yaml
	@perl -pi -e 's/^STIGMER_VERSION=v[0-9A-Za-z.+-]+$$/STIGMER_VERSION=v$(version)/; s/^(\s+--version )[0-9A-Za-z.+-]+( \\)$$/$${1}$(version)$${2}/' docs/guides/self-hosting/operations.mdx
	@echo "release pins set to $(version):"; git --no-pager diff --stat -- mcp-server/Dockerfile docker-compose.yml .env.example deploy/helm/stigmer/Chart.yaml docs/guides/self-hosting/operations.mdx

release: release-preflight ## Tag and push a release (usage: make release [bump=patch|minor|major]); run `make release-pins` and commit first
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
	COMPOSE_PIN=$$(git show HEAD:docker-compose.yml | sed -n -E 's/.*STIGMER_VERSION:-v([0-9A-Za-z.+-]+).*/\1/p' | sort -u | tr '\n' ' ' | sed 's/ $$//'); \
	ENV_PIN=$$(git show HEAD:.env.example | sed -n -E 's/^#STIGMER_VERSION=v(.*)$$/\1/p'); \
	CHART_PIN=$$(git show HEAD:deploy/helm/stigmer/Chart.yaml | sed -n -E 's/^version: (.*)$$/\1/p'); \
	CHART_APP_PIN=$$(git show HEAD:deploy/helm/stigmer/Chart.yaml | sed -n -E 's/^appVersion: "?([^"]*)"?$$/\1/p'); \
	DOCS_PIN=$$(git show HEAD:docs/guides/self-hosting/operations.mdx | sed -n -E 's/^STIGMER_VERSION=v(.*)$$/\1/p; s/^ +--version ([0-9A-Za-z.+-]+) \\$$/\1/p' | sort -u | tr '\n' ' ' | sed 's/ $$//'); \
	if [ "$$PIN" != "$$NEW_VERSION" ] || [ "$$COMPOSE_PIN" != "$$NEW_VERSION" ] || [ "$$ENV_PIN" != "$$NEW_VERSION" ] || [ "$$CHART_PIN" != "$$NEW_VERSION" ] || [ "$$CHART_APP_PIN" != "$$NEW_VERSION" ] || [ "$$DOCS_PIN" != "$$NEW_VERSION" ]; then \
		echo "error: the release pins at HEAD do not all name $$NEW_VERSION:"; \
		echo "  mcp-server/Dockerfile  MCP_SERVER_VERSION=$$PIN   (release.npm-libs refuses to publish on a mismatch; prod deploys the pin, not the tag)"; \
		echo "  docker-compose.yml     STIGMER_VERSION:-v$$COMPOSE_PIN   (a fresh clone runs this stack)"; \
		echo "  .env.example           #STIGMER_VERSION=v$$ENV_PIN"; \
		echo "  deploy/helm/stigmer/Chart.yaml  version=$$CHART_PIN appVersion=$$CHART_APP_PIN   (the chart's image tags default to v<appVersion>; release.npm-libs refuses to package on a mismatch)"; \
		echo "  docs/guides/self-hosting/operations.mdx  $$DOCS_PIN   (the version a reader copies into .env and helm upgrade --version)"; \
		echo "Bump them in a pull request, and tag the merged commit:"; \
		echo "  make release-pins version=$$NEW_VERSION"; \
		echo "  (.agents/skills/release-stigmer-oss/SKILL.md, section 3)"; \
		exit 1; \
	fi; \
	echo "$$LATEST_TAG -> $$NEW_TAG (release pins OK)"; \
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
	@echo "    + the server, runner and all-in-one images on GHCR, and the Helm chart"
	@echo "      at oci://ghcr.io/stigmer/charts/stigmer, each smoked before it is promoted or pushed"
	@echo "  - Go SDK (go get)                (sdk/go tag auto-cached by proxy.golang.org)"
	@echo "  - stigmer + stigmer-protos PyPI  (release.python-sdk.yaml)"
	@echo "  - MCP server Docker image        (release.mcp-server.yaml)"
	@echo "  - Live check on real providers   (ci.live.yaml, after the npm release)"

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
