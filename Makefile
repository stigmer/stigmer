bump ?= patch

GO_MODULES := \
	apis/stubs/go \
	backend/libs/go \
	backend/services/stigmer-server \
	backend/services/workflow-runner \
	client-apps/cli \
	mcp-server \
	sdk/go \
	tools

AGENT_RUNNER_DIR := backend/services/agent-runner

.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── Setup ────────────────────────────────────

.PHONY: setup
setup: ## Install all dependencies (one-time)
	@for mod in $(GO_MODULES); do \
		echo "go mod download  $$mod"; \
		(cd $$mod && go mod download) || exit 1; \
	done
	@echo "poetry install   $(AGENT_RUNNER_DIR)"
	@cd $(AGENT_RUNNER_DIR) && poetry install
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
	@command -v vale >/dev/null 2>&1 || { echo "error: vale not found — brew install vale"; exit 1; }
	@command -v lychee >/dev/null 2>&1 || { echo "error: lychee not found — brew install lychee"; exit 1; }
	@vale sync && echo "vale packages synced"

# ─── Build ────────────────────────────────────

.PHONY: build protos codegen gen-cli-docs gen-cli-docs-check
build: ## Build the Stigmer CLI binary
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "built: bin/stigmer"

protos: ## Generate protocol buffer stubs and SDK client code
	$(MAKE) -C apis build
	$(MAKE) -C sdk/go codegen
	$(MAKE) -C mcp-server codegen
	$(MAKE) -C sdk/typescript codegen
	$(MAKE) -C sdk/python codegen
	$(MAKE) -C sdk/java codegen

gen-cli-docs: ## Generate CLI reference docs from command tree
	$(MAKE) -C client-apps/cli gen-cli-docs

gen-cli-docs-check: ## Verify CLI docs are up to date (CI, no writes)
	$(MAKE) -C client-apps/cli gen-cli-docs-check

codegen: protos gen-cli-docs ## Regenerate all derived code (protos, SDKs, CLI docs)

# ─── Test ─────────────────────────────────────

.PHONY: test
test: ## Run all unit tests
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done
	@echo "testing  $(AGENT_RUNNER_DIR)"
	@cd $(AGENT_RUNNER_DIR) && poetry install --no-interaction --quiet && poetry run pytest

# ─── Tidy ────────────────────────────────────

.PHONY: tidy
tidy: ## Run go mod tidy on all Go modules
	@for mod in $(GO_MODULES); do \
		echo "go mod tidy   $$mod"; \
		(cd $$mod && go mod tidy) || exit 1; \
	done

# ─── Lint & Check ────────────────────────────

.PHONY: lint lint-docs lint-docs-audit format-docs format-docs-check check-links libs-build web-build check
lint: ## Run all linters and type checks
	@for mod in $(GO_MODULES); do \
		(cd $$mod && go vet ./...) || exit 1; \
	done
	@gofmt -s -w .
	@$(MAKE) -C apis lint
	@cd backend/libs/python/graphton && poetry run ruff check .
	@cd $(AGENT_RUNNER_DIR) && poetry run ruff check .
	@cd $(AGENT_RUNNER_DIR) && poetry install --no-interaction --quiet && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	npm run lint -w client-apps/web

libs-build:
	npm run build:libs
	npm test

web-build:
	npm run build -w client-apps/web

check: codegen tidy lint lint-docs format-docs-check libs-build web-build build test ## Run full CI gate locally

# ─── Docs Linting ─────────────────────────────

DOCS_SOURCES = $(shell find docs -path docs/_archive -prune -o \( -name '*.md' -o -name '*.mdx' \) -print)

lint-docs: ## Lint documentation with Vale (strict, fails on warnings+)
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
	@lychee --no-progress $(DOCS_SOURCES)

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

DEV_LDFLAGS := -X github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner.devSourceDir=$(CURDIR)/backend/services/agent-runner

.PHONY: local
local: ## Build + install CLI for local development
	@rm -f $(HOME)/bin/stigmer /usr/local/bin/stigmer bin/stigmer 2>/dev/null || true
	@$(MAKE) web-console-build
	@mkdir -p bin $(HOME)/bin
	@cd client-apps/cli && go build -tags 'embed_webconsole' -ldflags '$(DEV_LDFLAGS)' -o ../../bin/stigmer .
	@cp bin/stigmer $(HOME)/bin/stigmer && chmod +x $(HOME)/bin/stigmer
	@echo "cli: installed $(HOME)/bin/stigmer"
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

.PHONY: site docs-build gen-llms
site: ## Start the documentation website with hot reload
	$(MAKE) -C site dev

docs-build: ## Build the documentation site (production)
	$(MAKE) -C site build

gen-llms: ## Generate LLM-friendly output (llms.txt, llms-full.txt, per-page .md)
	cd site && yarn generate-llms

# ─── Release ──────────────────────────────────

.PHONY: release
release: ## Tag and push a release (usage: make release [bump=patch|minor|major])
	-$(MAKE) -C apis release
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
	@echo "  - CLI binaries + GitHub release  (release.cli.yaml)"
	@echo "  - @stigmer/* npm packages        (release.npm-libs.yaml)"
	@echo "  - Go SDK (go get)                (sdk/go tag auto-cached by proxy.golang.org)"
	@echo "  - stigmer + stigmer-protos PyPI  (release.python-sdk.yaml)"
	@echo "  - MCP server binaries + Docker   (release.mcp-server.yaml)"

# ─── Clean ────────────────────────────────────

.PHONY: clean
clean: ## Remove all build artifacts
	rm -rf bin/ coverage/ coverage.txt coverage.html
	rm -rf backend/services/workflow-runner/bin/
	rm -rf client-apps/cli/embedded/agentrunner/source/
	rm -rf client-apps/cli/embedded/webconsole/out/
	rm -rf client-apps/web/out/ client-apps/web/.next/
	$(MAKE) -C apis clean
