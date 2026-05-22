# Workflow execution routing integration tests for the Stigmer platform.
#
# Tests verify per-execution Temporal task queue routing (STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution).
# Structured in two tiers:
#   Tier 1 (offline): Temporal memo verification — no runner, no API keys
#   Tier 2 (offline): Runner IPC + child workflow dispatch — unified runner, no API keys
#
# Invoked from the repo root via:
#   make test-integration-wfexec-routing

# Disable Go workspace to avoid cross-module dependency conflicts (CI has no go.work).
export GOWORK := off

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
STIGMER_SERVICE_JAR ?= $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar

OUTPUT_DIR ?= .test-output-wfexec-routing

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
test: ensure-service-jar ensure-runner-built ## Run offline workflow execution routing tests (no API keys needed)
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
		-- -tags integration -timeout 600s -count=1 -v
