.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── npm Libraries (@stigmer/*) ──────────────

.PHONY: libs-build libs-clean libs-publish libs-publish-dry npm-login

libs-build: ## Build all @stigmer/* npm packages
	npm run clean:libs --prefix ../..
	npm run build:libs --prefix ../..

libs-clean: ## Remove dist/ from all @stigmer/* packages
	npm run clean:libs --prefix ../..

libs-publish: ## Publish @stigmer/* packages (VERSION=x.y.z required)
	@if [ -z "$(VERSION)" ]; then \
		echo "error: VERSION is required (e.g. make libs-publish VERSION=0.5.0)"; \
		exit 1; \
	fi
	node ../../scripts/publish-libs.mjs --version $(VERSION)

libs-publish-dry: ## Dry-run publish (VERSION=x.y.z required)
	@if [ -z "$(VERSION)" ]; then \
		echo "error: VERSION is required (e.g. make libs-publish-dry VERSION=0.5.0)"; \
		exit 1; \
	fi
	node ../../scripts/publish-libs.mjs --dry-run --version $(VERSION)

npm-login: ## Log in to npm (interactive, opens browser)
	npm login --auth-type=web
