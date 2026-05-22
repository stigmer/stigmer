# Integration test targets for the Stigmer platform.
# Invoked from the repo root via: make test-integration, test-integration-providers, test-integration-agent
# Can also be run directly: cd test/integration && make test

# Disable Go workspace to avoid cross-module dependency conflicts (CI has no go.work).
export GOWORK := off

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
STIGMER_SERVICE_JAR ?= $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar

OUTPUT_DIR          ?= .test-output
PROVIDER_OUTPUT_DIR ?= .test-output-providers
AGENT_OUTPUT_DIR    ?= .test-output-agent
STRESS_OUTPUT_DIR   ?= .test-output-stress

# ─── Quarantine ───────────────────────────────
# Known-flaky tests listed in quarantine.json are excluded from the blocking
# CI gate via Go's -skip flag. Set SKIP_QUARANTINE=false to run all tests
# (used by the stress lane and local debugging).

QUARANTINE_FILE  := $(CURDIR)/quarantine.json
SKIP_QUARANTINE  ?= true

# Reads quarantine.json and emits -skip 'Pattern' if tests are listed.
# Requires jq (available on ubuntu-latest and most dev machines).
define quarantine_skip_args
$(shell \
	if [ "$(SKIP_QUARANTINE)" = "true" ] && [ -f "$(QUARANTINE_FILE)" ]; then \
		NAMES=$$(jq -r '.quarantined[]?.test // empty' "$(QUARANTINE_FILE)" 2>/dev/null | paste -sd '|' -); \
		if [ -n "$$NAMES" ]; then \
			echo "-skip '$$NAMES'"; \
		fi; \
	fi \
)
endef

# ─── Rerun / Flake Detection ─────────────────
# gotestsum reruns failed tests to distinguish flakes from real breakage.
# --rerun-fails-max-failures prevents masking widespread failures.
# --rerun-fails-run-root-test reruns the entire root test when subtests fail
# (critical for table-driven tests that share setup).

RERUN_FLAGS = \
	--rerun-fails=2 \
	--rerun-fails-max-failures=5 \
	--rerun-fails-run-root-test

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

# ─── Targets ──────────────────────────────────

.PHONY: test
test: ensure-service-jar ## Run offline integration tests (no API keys needed)
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
		$(RERUN_FLAGS) \
		--rerun-fails-report $(OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args)

.PHONY: test-providers
test-providers: ensure-service-jar ## Run provider-backed integration tests (auto-fetches API keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(PROVIDER_OUTPUT_DIR)
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			echo "  either: export ANTHROPIC_API_KEY=<key>"; \
			echo "  or:     install planton CLI (brew install plantonhq/tap/planton)"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor tests will be skipped"; fi; \
	fi; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(PROVIDER_OUTPUT_DIR)) gotestsum \
		--junitfile $(PROVIDER_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(PROVIDER_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(PROVIDER_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args) -run 'TestWorkflow(LlmCall|AgentCall|CursorCall|Architect|Eval)|TestAgentExecution'

.PHONY: test-canary
test-canary: ensure-service-jar ## Run canary tests (live provider health checks, auto-fetches API keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p .test-output-canary
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			echo "  either: export ANTHROPIC_API_KEY=<key>"; \
			echo "  or:     install planton CLI (brew install plantonhq/tap/planton)"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor canary will be skipped"; fi; \
	fi; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath .test-output-canary) gotestsum \
		--junitfile .test-output-canary/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile .test-output-canary/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 600s -count=1 -run 'TestCanary_'

.PHONY: test-workflow-architect
test-workflow-architect: ensure-service-jar ## Run Workflow Architect agent E2E tests (auto-fetches API keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p .test-output-architect
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath .test-output-architect) gotestsum \
		--junitfile .test-output-architect/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile .test-output-architect/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report .test-output-architect/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args) -run 'TestWorkflowArchitect'

.PHONY: test-agent
test-agent: ensure-service-jar ## Run agent execution integration tests (auto-fetches API keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(AGENT_OUTPUT_DIR)
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(AGENT_OUTPUT_DIR)) gotestsum \
		--junitfile $(AGENT_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(AGENT_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(AGENT_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args) -run 'TestAgentExecution'

FAILING_OUTPUT_DIR ?= .test-output-failing
TEST_RUN ?=

.PHONY: test-subset
test-subset: ensure-service-jar ## Run a subset of integration tests: make test-subset TEST_RUN='TestFoo|TestBar'
	@if [ -z "$(TEST_RUN)" ]; then \
		echo "error: TEST_RUN is required"; \
		echo "  usage: make test-subset TEST_RUN='TestAgentExecution_Foo|TestAgentExecution_Bar'"; \
		exit 1; \
	fi
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(FAILING_OUTPUT_DIR)
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ] && command -v planton >/dev/null 2>&1; then \
		echo "Fetching CURSOR_API_KEY from Planton..."; \
		CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1 || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	echo "Running tests matching: $(TEST_RUN)"; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(FAILING_OUTPUT_DIR)) gotestsum \
		--junitfile $(FAILING_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(FAILING_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(FAILING_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 \
		-run '$(TEST_RUN)'

SDK_OUTPUT_DIR ?= .test-output-sdk

.PHONY: test-sdk
test-sdk: ensure-service-jar ## Run SDK acceptance smoke tests (Go, TypeScript, Python)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(SDK_OUTPUT_DIR)
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(SDK_OUTPUT_DIR)) gotestsum \
		--junitfile $(SDK_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(SDK_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(SDK_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 300s -count=1 $(call quarantine_skip_args) -run 'TestSDKAcceptance' -v

REPLAY_HISTORY_OUTPUT_DIR ?= ../../backend/services/workflow-runner/test/replay/testdata/replay-histories
REPLAY_CAPTURE_OUTPUT_DIR ?= .test-output-replay-capture

.PHONY: capture-replay-histories
capture-replay-histories: ensure-service-jar ## Capture Temporal event histories for replay determinism tests
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(REPLAY_CAPTURE_OUTPUT_DIR)
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(REPLAY_CAPTURE_OUTPUT_DIR)) \
	CAPTURE_REPLAY_HISTORIES=1 \
	REPLAY_HISTORY_OUTPUT_DIR=$(abspath $(REPLAY_HISTORY_OUTPUT_DIR)) gotestsum \
		--junitfile $(REPLAY_CAPTURE_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(REPLAY_CAPTURE_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 300s -count=1 -run 'TestCaptureReplayHistories' -v
	@echo ""
	@echo "Histories written to: $(abspath $(REPLAY_HISTORY_OUTPUT_DIR))"
	@ls -la $(abspath $(REPLAY_HISTORY_OUTPUT_DIR))/*.json 2>/dev/null || echo "  (no history files found — check test output above)"

BENCHMARK_OUTPUT_DIR ?= .test-output-benchmark

.PHONY: benchmark-cost
benchmark-cost: ensure-service-jar ## Run cost benchmarks comparing Native vs Cursor harness (requires both API keys)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(BENCHMARK_OUTPUT_DIR)
	@ANTHROPIC_KEY=$${ANTHROPIC_API_KEY:-}; \
	if [ -z "$$ANTHROPIC_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching ANTHROPIC_API_KEY from Planton..."; \
			ANTHROPIC_KEY=$$(planton service secrets get-value --org stigmer --group anthropic --name prod.api-key 2>&1); \
			if [ -z "$$ANTHROPIC_KEY" ]; then \
				echo "error: planton returned empty value for anthropic/prod.api-key"; \
				exit 1; \
			fi; \
		else \
			echo "error: ANTHROPIC_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching CURSOR_API_KEY from Planton..."; \
			CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1); \
			if [ -z "$$CURSOR_KEY" ]; then \
				echo "error: CURSOR_API_KEY required for cost benchmarks (native vs cursor comparison)"; \
				exit 1; \
			fi; \
		else \
			echo "error: CURSOR_API_KEY not set and planton CLI not found"; \
			echo "  cost benchmarks require both API keys to compare harnesses"; \
			exit 1; \
		fi; \
	fi; \
	echo "Running cost benchmarks (native vs cursor)..."; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(BENCHMARK_OUTPUT_DIR)) gotestsum \
		--junitfile $(BENCHMARK_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(BENCHMARK_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags 'integration benchmark' -timeout 1800s -count=1 -run 'TestCostBenchmark'

TRACED_OUTPUT_DIR ?= .test-output-traced

CURSOR_MODE_OUTPUT_DIR ?= .test-output-cursor-modes

.PHONY: benchmark-cursor-modes
benchmark-cursor-modes: ensure-service-jar ## Compare Cursor local vs cloud runtime (requires CURSOR_API_KEY only)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(CURSOR_MODE_OUTPUT_DIR)
	@CURSOR_KEY=$${CURSOR_API_KEY:-}; \
	if [ -z "$$CURSOR_KEY" ]; then \
		if command -v planton >/dev/null 2>&1; then \
			echo "Fetching CURSOR_API_KEY from Planton..."; \
			CURSOR_KEY=$$(planton service secrets get-value --org stigmer --group cursor --name prod.api-key 2>&1); \
			if [ -z "$$CURSOR_KEY" ]; then \
				echo "error: CURSOR_API_KEY required for cursor mode benchmarks"; \
				exit 1; \
			fi; \
		else \
			echo "error: CURSOR_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	echo "Running cursor mode benchmarks (local vs cloud)..."; \
	CURSOR_API_KEY=$$CURSOR_KEY \
	STIGMER_CURSOR_CLOUD_MODE_ENABLED=true \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(CURSOR_MODE_OUTPUT_DIR)) gotestsum \
		--junitfile $(CURSOR_MODE_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(CURSOR_MODE_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags 'integration benchmark' -timeout 1800s -count=1 -run 'TestCostBenchmark_CursorLocalVsCloud'

.PHONY: test-traced
test-traced: ensure-service-jar ## Run offline integration tests with OTel tracing (Jaeger)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(TRACED_OUTPUT_DIR)
	INTEGRATION_TEST_OTEL=true \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(TRACED_OUTPUT_DIR)) gotestsum \
		--junitfile $(TRACED_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(TRACED_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(TRACED_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args)
	@echo ""
	@echo "Trace bundles (failed tests): $(TRACED_OUTPUT_DIR)/traces/"
	@ls $(TRACED_OUTPUT_DIR)/traces/*.json 2>/dev/null || echo "  (no failed tests — no trace bundles)"

# ─── Stress Testing ──────────────────────────
# Runs the offline integration suite multiple times to surface timing-dependent
# flakes. Quarantine skip is disabled so quarantined tests are also exercised.

.PHONY: test-stress
test-stress: ensure-service-jar ## Run offline integration tests 3x to detect flakes (no quarantine skip)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p $(STRESS_OUTPUT_DIR)
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(STRESS_OUTPUT_DIR)) gotestsum \
		--junitfile $(STRESS_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(STRESS_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 900s -count=3

# ─── Flake Report ────────────────────────────
# Generates a markdown health report from existing test output. Intended for
# use in CI (piped to $GITHUB_STEP_SUMMARY) or local inspection.

FLAKETRACK := go run $(CURDIR)/tools/flaketrack

.PHONY: flaketrack-report
flaketrack-report: ## Generate flake report from existing test output (specify REPORT_DIR)
	@REPORT_DIR=$${REPORT_DIR:-$(OUTPUT_DIR)}; \
	if [ ! -f "$$REPORT_DIR/test-output.json" ]; then \
		echo "error: $$REPORT_DIR/test-output.json not found — run tests first"; \
		exit 1; \
	fi; \
	$(FLAKETRACK) report \
		--json "$$REPORT_DIR/test-output.json" \
		--rerun-report "$$REPORT_DIR/rerun-report.txt" \
		--quarantine "$(QUARANTINE_FILE)"
