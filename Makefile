bump ?= patch
sandbox ?= basic

GO_MODULES := \
	apis/stubs/go \
	backend/libs/go \
	backend/services/stigmer-server \
	backend/services/workflow-runner \
	client-apps/cli \
	mcp-server \
	sdk/go

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

# ─── Build ────────────────────────────────────

.PHONY: build protos
build: ## Build the Stigmer CLI binary
	@mkdir -p bin
	cd client-apps/cli && go build -o ../../bin/stigmer .
	@echo "built: bin/stigmer"

protos: ## Generate protocol buffer stubs
	$(MAKE) -C apis build

# ─── Test ─────────────────────────────────────

.PHONY: test test-e2e
test: ## Run all unit tests
	@for mod in $(GO_MODULES); do \
		echo "testing  $$mod"; \
		(cd $$mod && go test -race -timeout 30s ./...) || exit 1; \
	done
	@echo "testing  $(AGENT_RUNNER_DIR)"
	@cd $(AGENT_RUNNER_DIR) && poetry install --no-interaction --quiet && poetry run pytest

test-e2e: ## Run E2E tests (requires running stigmer server + ollama)
	cd test/e2e && go test -v -tags=e2e -timeout 60s ./...

# ─── Tidy ────────────────────────────────────

.PHONY: tidy
tidy: ## Run go mod tidy on all Go modules
	@for mod in $(GO_MODULES); do \
		echo "go mod tidy   $$mod"; \
		(cd $$mod && go mod tidy) || exit 1; \
	done

# ─── Lint ─────────────────────────────────────

.PHONY: lint check
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

check: tidy lint build test ## Run full CI gate locally

# ─── Dependencies ─────────────────────────────

.PHONY: update-agent-runner-deps
update-agent-runner-deps: ## Regenerate agent-runner requirements.txt from poetry.lock
	@cd $(AGENT_RUNNER_DIR) && poetry show --only main --no-ansi \
		| awk '{ name=$$1; ver=$$2; if (name=="graphton" || name=="stigmer-stubs") next; printf "%s==%s\n", name, ver }' \
		| sort > /tmp/stigmer-ar-deps.txt
	@cd $(AGENT_RUNNER_DIR) && poetry show pathspec --no-ansi >/dev/null 2>&1 \
		&& echo "pathspec==$$(cd $(AGENT_RUNNER_DIR) && poetry show pathspec --no-ansi | awk '/version/{print $$3}')" >> /tmp/stigmer-ar-deps.txt \
		&& sort -o /tmp/stigmer-ar-deps.txt /tmp/stigmer-ar-deps.txt || true
	@{ echo "# Auto-generated from poetry.lock — do not edit manually."; \
	   echo "# Regenerate with: make update-agent-runner-deps"; \
	   echo "#"; \
	   echo "# This file lists all PyPI dependencies (direct + transitive) needed to run"; \
	   echo "# agent-runner inside the hermetic pythonrt venv.  Path dependencies (graphton,"; \
	   echo "# stigmer-stubs) are excluded; they are installed separately from the local"; \
	   echo "# source tree by the bootstrap pipeline."; \
	   cat /tmp/stigmer-ar-deps.txt; \
	} > $(AGENT_RUNNER_DIR)/requirements.txt
	@rm -f /tmp/stigmer-ar-deps.txt
	@echo "updated: $(AGENT_RUNNER_DIR)/requirements.txt ($$(wc -l < $(AGENT_RUNNER_DIR)/requirements.txt | tr -d ' ') lines)"

# ─── Local Dev ────────────────────────────────

DEV_LDFLAGS := -X github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner.devSourceDir=$(CURDIR)/backend/services/agent-runner

.PHONY: local build-release
local: ## Build + install CLI for local development
	@rm -f $(HOME)/bin/stigmer /usr/local/bin/stigmer bin/stigmer 2>/dev/null || true
	@mkdir -p bin $(HOME)/bin
	@cd client-apps/cli && go build -ldflags '$(DEV_LDFLAGS)' -o ../../bin/stigmer .
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

web-console-build: ## Build web console static assets for embedding
	npm run build -w client-apps/web
	@rm -rf client-apps/cli/embedded/webconsole/out
	@cp -r client-apps/web/out client-apps/cli/embedded/webconsole/out
	@echo "copied: client-apps/web/out -> client-apps/cli/embedded/webconsole/out"

build-release: ## Build CLI with embedded agent-runner and web console (production-like)
	@cd client-apps/cli/embedded/agentrunner && chmod +x sync.sh && ./sync.sh
	@$(MAKE) web-console-build
	@mkdir -p bin
	cd client-apps/cli && go build -tags 'embed_agentrunner embed_webconsole' -o ../../bin/stigmer .
	@echo "built: bin/stigmer (with embedded agent-runner + web console)"

# ─── Release ──────────────────────────────────

.PHONY: release protos-release
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
	git tag -a "apis/stubs/go/$$NEW_TAG" -m "Release apis/stubs/go $$NEW_TAG"; \
	git tag -a "$$NEW_TAG" -m "Release $$NEW_TAG"; \
	git tag -a "mcp-server/$$NEW_TAG" -m "Release mcp-server $$NEW_TAG"; \
	git push origin "apis/stubs/go/$$NEW_TAG" "$$NEW_TAG" "mcp-server/$$NEW_TAG"

protos-release: ## Publish protos to Buf, then tag release
	$(MAKE) -C apis release
	$(MAKE) release bump=$(bump)

# ─── Sandbox ──────────────────────────────────

.PHONY: sandbox sandbox-clean
sandbox: ## Build sandbox image (usage: make sandbox [sandbox=basic|full])
	cd $(AGENT_RUNNER_DIR)/sandbox && \
		docker build -f Dockerfile.sandbox.$(sandbox) -t stigmer-sandbox-$(sandbox):local .
	@echo "built: stigmer-sandbox-$(sandbox):local"

sandbox-clean: ## Remove all sandbox images
	@docker rmi stigmer-sandbox-basic:local 2>/dev/null || true
	@docker rmi stigmer-sandbox-full:local 2>/dev/null || true

# ─── Clean ────────────────────────────────────

.PHONY: clean
clean: ## Remove all build artifacts
	rm -rf bin/ coverage/ coverage.txt coverage.html
	rm -rf backend/services/workflow-runner/bin/
	rm -rf client-apps/cli/embedded/agentrunner/source/
	$(MAKE) -C apis clean
