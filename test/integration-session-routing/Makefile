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

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
STIGMER_SERVICE_JAR ?= $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar

OUTPUT_DIR          ?= .test-output-session-routing
PROVIDER_OUTPUT_DIR ?= .test-output-session-routing-providers

.PHONY: ensure-service-jar
ensure-service-jar:
	@if [ -f "$(STIGMER_SERVICE_JAR)" ]; then \
		echo "stigmer-service JAR: $(STIGMER_SERVICE_JAR)"; \
	elif [ -d "$(STIGMER_CLOUD_ROOT)" ]; then \
		echo "Building stigmer-service fat JAR from $(STIGMER_CLOUD_ROOT)..."; \
		cd "$(STIGMER_CLOUD_ROOT)" && bazel build //backend/services/stigmer-service:stigmer_service_fatjar; \
	else \
		echo "error: stigmer-cloud repo not found at $(STIGMER_CLOUD_ROOT)"; \
		echo "  either: clone stigmer-cloud as a sibling directory"; \
		echo "  or:     set STIGMER_SERVICE_JAR to an existing JAR path"; \
		exit 1; \
	fi

# ─── Offline Tests (Tier 1 + Tier 2) ────────────────────────────────────────

.PHONY: test
test: ensure-service-jar ## Run offline session routing tests (no API keys needed)
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

.PHONY: test-providers
test-providers: ensure-service-jar ## Run provider-backed session routing E2E tests (auto-fetches CURSOR_API_KEY)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(PROVIDER_OUTPUT_DIR)
	@CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching CURSOR_API_KEY from Planton..."; \
			CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
			if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — E2E tests will be skipped"; fi; \
		else \
			echo "warning: CURSOR_API_KEY not set and planton CLI not found — E2E tests will be skipped"; \
		fi; \
	fi; \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(PROVIDER_OUTPUT_DIR)) gotestsum \
		--junitfile $(PROVIDER_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(PROVIDER_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 -v
