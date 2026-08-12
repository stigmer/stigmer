# Session routing integration tests for the Stigmer platform.
#
# Tests verify per-session Temporal task queue routing (STIGMER_ACTIVITY_ROUTING=session).
# Structured in three tiers:
#   Tier 1 (offline): Temporal memo verification — no runner, no API keys
#   Tier 2 (offline): Runner IPC + activity dispatch — unified runner, no API keys
#   Tier 3 (provider): Full E2E — unified runner + CURSOR_API_KEY
#
# Invoked from the repo root via:
#   make test-integration-session-routing            # Tier 1 + 2 (offline)
#   make test-integration-session-routing-providers   # Tier 3 (provider-backed)

# Disable Go workspace to avoid cross-module dependency conflicts (CI has no go.work).
export GOWORK := off

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
# Resolved separately so ensure-service-jar can tell whether the caller
# overrode the path (e.g. a CI prebuilt artifact) or left it at the default.
STIGMER_SERVICE_JAR_DEFAULT := $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar
STIGMER_SERVICE_JAR ?= $(STIGMER_SERVICE_JAR_DEFAULT)

OUTPUT_DIR          ?= .test-output-session-routing
PROVIDER_OUTPUT_DIR ?= .test-output-session-routing-providers

# Guarantees the service JAR reflects current stigmer-cloud sources. When the
# default JAR path is used and bazel + the repo are available, this always runs
# an incremental `bazel build` (a fast no-op when up to date), so a JAR built
# before a `git pull` can never be silently reused. A caller-provided
# STIGMER_SERVICE_JAR (e.g. a CI prebuilt artifact) is taken as-is and only
# checked for existence — its freshness is the caller's responsibility.
.PHONY: ensure-service-jar
ensure-service-jar:
	@if [ "$(STIGMER_SERVICE_JAR)" != "$(STIGMER_SERVICE_JAR_DEFAULT)" ]; then \
		if [ -f "$(STIGMER_SERVICE_JAR)" ]; then \
			echo "stigmer-service JAR (caller-provided): $(STIGMER_SERVICE_JAR)"; \
		else \
			echo "error: STIGMER_SERVICE_JAR set to a path that does not exist: $(STIGMER_SERVICE_JAR)"; \
			exit 1; \
		fi; \
	elif [ -d "$(STIGMER_CLOUD_ROOT)" ] && command -v bazel >/dev/null 2>&1; then \
		echo "Building stigmer-service fat JAR (incremental) from $(STIGMER_CLOUD_ROOT)..."; \
		cd "$(STIGMER_CLOUD_ROOT)" && bazel build //backend/services/stigmer-service:stigmer_service_fatjar; \
	elif [ -f "$(STIGMER_SERVICE_JAR)" ]; then \
		echo "warning: bazel or stigmer-cloud repo unavailable — using existing JAR, which may be stale: $(STIGMER_SERVICE_JAR)"; \
	else \
		echo "error: stigmer-cloud repo not found at $(STIGMER_CLOUD_ROOT)"; \
		echo "  either: clone stigmer-cloud as a sibling directory"; \
		echo "  or:     set STIGMER_SERVICE_JAR to an existing JAR path"; \
		exit 1; \
	fi

RUNNER_DIR := $(CURDIR)/../../backend/services/runner
PROTOS_DIR := $(CURDIR)/../../apis/stubs/ts

.PHONY: ensure-protos-built ensure-runner-built

ensure-protos-built:
	@if [ ! -d "$(PROTOS_DIR)/dist/ai" ]; then \
		echo "Building proto stubs TypeScript..."; \
		cd "$(PROTOS_DIR)" && npm run build; \
	else \
		echo "proto stubs: already built"; \
	fi

ensure-runner-built: ensure-protos-built
	@if [ ! -f "$(RUNNER_DIR)/dist/main.js" ]; then \
		echo "Building unified runner TypeScript..."; \
		cd "$(RUNNER_DIR)" && npm run build; \
	else \
		echo "unified runner: already built"; \
	fi

# ─── Offline Tests (Tier 1 + Tier 2) ────────────────────────────────────────

.PHONY: test
test: ensure-service-jar ensure-runner-built ## Run offline session routing tests (no API keys needed)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(OUTPUT_DIR)
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(OUTPUT_DIR)) gotestsum \
		--junitfile $(OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 600s -count=1 -v \
		-run 'TestSessionRouting|TestDispatch|TestCloud'

# ─── Provider-Backed Tests (Tier 3) ─────────────────────────────────────────

# Fetch a Planton secret's value (the test/integration/Makefile idiom): the
# CLI renders a decorated box, so the value is extracted from the "Value"
# line, ANSI-stripped. Empty result means "fetch failed" — callers skip.
# The previous `planton service secrets get-value` syntax is obsolete and
# silently captured the CLI error text as the key.
define planton_get_secret
planton secret get $(1) --env prod --org stigmer 2>/dev/null | awk '{ gsub(/\033\[[0-9;]*m/, "") } /^[[:space:]]*Value[[:space:]]+/ { sub(/^[[:space:]]*Value[[:space:]]+/, ""); gsub(/[[:space:]]+$$/, ""); print; exit }'
endef

.PHONY: test-providers
test-providers: ensure-service-jar ensure-runner-built ## Run provider-backed session routing E2E tests (auto-fetches Cursor keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(PROVIDER_OUTPUT_DIR)
	@CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — E2E tests will be skipped"; fi; \
	fi; \
	CURSOR_ADMIN=$${CURSOR_ADMIN_KEY:-}; \
	if [ -z "$$CURSOR_ADMIN" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_ADMIN_KEY from Planton..."; \
		CURSOR_ADMIN=$$($(call planton_get_secret,cursor-admin) || true); \
		if [ -n "$$CURSOR_ADMIN" ]; then echo "CURSOR_ADMIN_KEY fetched"; else echo "CURSOR_ADMIN_KEY not available — E2E tests will be skipped (shared-pool seed needs it)"; fi; \
	fi; \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(PROVIDER_OUTPUT_DIR)) gotestsum \
		--junitfile $(PROVIDER_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(PROVIDER_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 -v
