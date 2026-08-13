# Integration test targets for the Stigmer platform.
# Invoked from the repo root via: make test-integration, test-integration-providers, test-integration-agent
# Can also be run directly: cd test/integration && make test

# Disable Go workspace to avoid cross-module dependency conflicts (CI has no go.work).
export GOWORK := off

STIGMER_ROOT       := $(CURDIR)/../..
STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
# Resolved separately so ensure-service-jar can tell whether the caller
# overrode the path (e.g. a CI prebuilt artifact) or left it at the default.
STIGMER_SERVICE_JAR_DEFAULT := $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar
STIGMER_SERVICE_JAR ?= $(STIGMER_SERVICE_JAR_DEFAULT)

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

# ─── Planton Secret Fetch ────────────────────
# Fetch a Planton secret's value for use as an API key. Secrets are
# environment-scoped to `prod` (slugs: anthropic, cursor, cursor-admin). The
# CLI renders a decorated box even with `-o plain`, so we extract the value
# from the "Value" line (stripping any ANSI). On failure (not logged in / not
# found) stdout has no "Value" line, so the result is empty — which callers
# treat as "fetch failed". Replaces the obsolete `planton service secrets
# get-value --group/--name` syntax, which silently captured the CLI error
# text as the key.
#   Usage in a recipe: KEY=$$($(call planton_get_secret,<slug>))
define planton_get_secret
planton secret get $(1) --env prod --org stigmer 2>/dev/null | awk '{ gsub(/\033\[[0-9;]*m/, "") } /^[[:space:]]*Value[[:space:]]+/ { sub(/^[[:space:]]*Value[[:space:]]+/, ""); gsub(/[[:space:]]+$$/, ""); print; exit }'
endef

# Best-effort fetch of the Cursor team Admin API key (CURSOR_ADMIN_KEY). The
# suite's boot-time shared-pool CursorAccount seed needs it alongside the
# user-scoped CURSOR_API_KEY (DD-008: DB-resident CursorAccounts are the only
# Cursor credential source; the seed's upsert live-validates the admin key).
# Optional like the cursor key: when absent, cursor tests skip honestly via
# RequireCursorPrereqs. Recipes that HARD-require cursor add their own
# emptiness check after expanding this.
#   Usage in a recipe (inside the same shell chain): $(call fetch_cursor_admin_key)
define fetch_cursor_admin_key
CURSOR_ADMIN=$${CURSOR_ADMIN_KEY:-}; \
if [ -z "$$CURSOR_ADMIN" ] && command -v planton >/dev/null 2>&1; then \
	echo "Fetching CURSOR_ADMIN_KEY from Planton..."; \
	CURSOR_ADMIN=$$($(call planton_get_secret,cursor-admin) || true); \
	if [ -n "$$CURSOR_ADMIN" ]; then echo "CURSOR_ADMIN_KEY fetched"; else echo "CURSOR_ADMIN_KEY not available — cursor tests will be skipped (shared-pool seed needs it)"; fi; \
fi
endef

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

# Guarantees the runner's dist/ reflects current sources before money is spent.
# The harness prefers dist/main.js over tsx (resolveRunnerCommand), but nothing
# on these lanes rebuilds it, so a dist built before a `git pull` runs stale
# code. The runner's own fingerprint guard (checkBuildFreshness, exit 78) fires
# too late for a paid lane: a runner that dies at startup hits the same
# silent-timeout mode documented on check-runner-node — after spend has begun.
#
# Delegates to the root `build-runner` target — the one canonical build path,
# which also refreshes the @stigmer/protos dist and node_modules; a bare
# `npm run build` here could compile against stale proto stubs.
#
# Deliberately asymmetric to ensure-service-jar: no warn-and-proceed branch
# and no override variable. The runner lives in this repo (it cannot be
# legitimately absent, unlike the stigmer-cloud checkout), and a maybe-stale
# fallback on a lane whose entire output is trusted cost numbers would
# reintroduce the exact footgun this target exists to close.
.PHONY: ensure-runner-dist
ensure-runner-dist:
	@echo "Rebuilding unified runner dist (via root build-runner)..."
	@$(MAKE) -C $(STIGMER_ROOT) build-runner

# ─── Targets ──────────────────────────────────

.PHONY: test
test: check-runner-node ensure-service-jar ## Run offline integration tests (no API keys needed)
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
test-providers: check-runner-node ensure-service-jar ## Run provider-backed integration tests (auto-fetches API keys)
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor tests will be skipped"; fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(PROVIDER_OUTPUT_DIR)) gotestsum \
		--junitfile $(PROVIDER_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(PROVIDER_OUTPUT_DIR)/test-output.json \
		--format testname \
		$(RERUN_FLAGS) \
		--rerun-fails-report $(PROVIDER_OUTPUT_DIR)/rerun-report.txt \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 $(call quarantine_skip_args) -run 'TestWorkflow(LlmCall|AgentCall|CursorCall|Architect|Eval|_StructuredOutput)|TestAgentExecution'

.PHONY: test-canary
test-canary: check-runner-node ensure-service-jar ## Run canary tests (live provider health checks, auto-fetches API keys)
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor canary will be skipped"; fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath .test-output-canary) gotestsum \
		--junitfile .test-output-canary/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile .test-output-canary/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 600s -count=1 -run 'TestCanary_'

# ─── Seedpack canary lane ────────────────────
# Runs inside this package's full harness (TestMain boots the service JAR,
# Temporal, and the unified runner), so the go-test timeout must absorb the
# boot — the suite's standard 900s, not a probe-sized budget. The prerequisites
# close the vacuous-green mode: without ensure-service-jar a missing JAR makes
# TestMain exit 0 having run nothing (oss#565). The harness-free transport
# reachability probes used to live here too; they moved to the seedpack
# module (root `make test-seedpack-transport`, oss#569).
#
# No LLM keys here by design: the provider canaries the TestCanary_ regex
# also matches skip themselves without ANTHROPIC/OPENAI keys — lane
# disjointness is enforced by the tests' own env guards.

.PHONY: test-seedpack-canary
test-seedpack-canary: check-runner-node ensure-service-jar ## Run seedpack canary tests with real credentials (nightly)
	@command -v gotestsum >/dev/null 2>&1 || { \
		echo "error: gotestsum not found"; \
		echo "  install: go install gotest.tools/gotestsum@latest"; \
		exit 1; \
	}
	@mkdir -p .test-output-seedpack-canary
	STIGMER_MCP_CANARY=true \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath .test-output-seedpack-canary) gotestsum \
		--junitfile .test-output-seedpack-canary/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile .test-output-seedpack-canary/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags integration -timeout 900s -count=1 -run 'TestCanary_'

.PHONY: test-workflow-architect
test-workflow-architect: check-runner-node ensure-service-jar ## Run Workflow Architect agent E2E tests (auto-fetches API keys)
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
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
test-agent: check-runner-node ensure-service-jar ## Run agent execution integration tests (auto-fetches API keys)
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
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
test-subset: check-runner-node ensure-service-jar ## Run a subset of integration tests: make test-subset TEST_RUN='TestFoo|TestBar'
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
		CURSOR_KEY=$$($(call planton_get_secret,cursor) || true); \
		if [ -n "$$CURSOR_KEY" ]; then echo "CURSOR_API_KEY fetched"; else echo "CURSOR_API_KEY not available — cursor subtests will be skipped"; fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	echo "Running tests matching: $(TEST_RUN)"; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
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
test-sdk: check-runner-node ensure-service-jar ## Run SDK acceptance smoke tests (Go, TypeScript, Python)
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

# Captured histories land locally by default. The old default pointed at
# backend/services/workflow-runner/test/replay/testdata/ — a directory that
# left with the retired Go workflow-runner; no committed gold-master location
# exists today. Override REPLAY_HISTORY_OUTPUT_DIR to export elsewhere.
REPLAY_CAPTURE_OUTPUT_DIR ?= .test-output-replay-capture
REPLAY_HISTORY_OUTPUT_DIR ?= $(REPLAY_CAPTURE_OUTPUT_DIR)/replay-histories

.PHONY: capture-replay-histories
capture-replay-histories: check-runner-node ensure-service-jar ## Capture Temporal event histories for replay determinism tests
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

# Test selection for benchmark-cost. The default prefix matches every
# TestCostBenchmark* test, including TestCostBenchmark_CursorLocalVsCloud_*,
# which additionally require STIGMER_CURSOR_CLOUD_MODE_ENABLED=true (set only
# by benchmark-cursor-modes). Narrow the pattern when running native-vs-cursor
# comparisons alone, e.g.:
#   make benchmark-cost BENCHMARK_RUN_PATTERN='TestCostBenchmark_(SimpleReply|MediumContext|ModelParity|MultiTurn|Report)'
BENCHMARK_RUN_PATTERN ?= TestCostBenchmark

# The unified runner requires node:sqlite (Cursor SDK local state). On a Node
# without it (e.g. 23.1.0; needs 22.13+/23.4+) the runner prints one error and
# dies, and every runner-dependent test strands in a silent timeout instead of
# failing fast (oss#307: 6 tests "failed deterministically" for weeks before
# the Node version was identified). Every lane in this Makefile boots the
# runner through the suite's TestMain, so every lane gets this guard as its
# first prerequisite — it turns a multi-hour debugging trap into a two-second
# actionable error. On the paid benchmark lanes it additionally prevents
# burning a full run before anyone notices.
.PHONY: check-runner-node
check-runner-node:
	@command -v node >/dev/null 2>&1 || { \
		echo "error: node not found — the unified runner requires Node with node:sqlite"; \
		echo "  fix: nvm use v22.22.1 (or any Node >= 22.13 / >= 23.4)"; \
		exit 1; \
	}
	@node -e "require('node:sqlite')" >/dev/null 2>&1 || { \
		echo "error: Node $$(node --version) lacks node:sqlite — the unified runner will die at startup"; \
		echo "  and every runner-dependent test (or paid benchmark run) would strand in a silent"; \
		echo "  multi-minute timeout instead of failing (oss#307)."; \
		echo "  fix: nvm use v22.22.1 (or any Node >= 22.13 / >= 23.4)"; \
		exit 1; \
	}

.PHONY: benchmark-cost
benchmark-cost: check-runner-node ensure-service-jar ensure-runner-dist ## Run cost benchmarks comparing Native vs Cursor harness (requires both API keys)
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
			ANTHROPIC_KEY=$$($(call planton_get_secret,anthropic)); \
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
			CURSOR_KEY=$$($(call planton_get_secret,cursor)); \
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
	$(call fetch_cursor_admin_key); \
	if [ -z "$$CURSOR_ADMIN" ]; then \
		echo "error: CURSOR_ADMIN_KEY required — the shared-pool CursorAccount seed needs the team admin key"; \
		exit 1; \
	fi; \
	echo "Running cost benchmarks (native vs cursor)..."; \
	ANTHROPIC_API_KEY=$$ANTHROPIC_KEY \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
	STIGMER_SERVICE_JAR=$(STIGMER_SERVICE_JAR) \
	INTEGRATION_TEST_OUTPUT_DIR=$(abspath $(BENCHMARK_OUTPUT_DIR)) gotestsum \
		--junitfile $(BENCHMARK_OUTPUT_DIR)/junit.xml \
		--junitfile-testsuite-name short \
		--jsonfile $(BENCHMARK_OUTPUT_DIR)/test-output.json \
		--format testname \
		--packages ./... \
		-- -tags 'integration benchmark' -timeout 1800s -count=1 -run '$(BENCHMARK_RUN_PATTERN)'

TRACED_OUTPUT_DIR ?= .test-output-traced

CURSOR_MODE_OUTPUT_DIR ?= .test-output-cursor-modes

.PHONY: benchmark-cursor-modes
benchmark-cursor-modes: check-runner-node ensure-service-jar ensure-runner-dist ## Compare Cursor local vs cloud runtime (requires CURSOR_API_KEY only)
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
			CURSOR_KEY=$$($(call planton_get_secret,cursor)); \
			if [ -z "$$CURSOR_KEY" ]; then \
				echo "error: CURSOR_API_KEY required for cursor mode benchmarks"; \
				exit 1; \
			fi; \
		else \
			echo "error: CURSOR_API_KEY not set and planton CLI not found"; \
			exit 1; \
		fi; \
	fi; \
	$(call fetch_cursor_admin_key); \
	if [ -z "$$CURSOR_ADMIN" ]; then \
		echo "error: CURSOR_ADMIN_KEY required — the shared-pool CursorAccount seed needs the team admin key"; \
		exit 1; \
	fi; \
	echo "Running cursor mode benchmarks (local vs cloud)..."; \
	CURSOR_API_KEY=$$CURSOR_KEY \
	CURSOR_ADMIN_KEY=$$CURSOR_ADMIN \
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
test-traced: check-runner-node ensure-service-jar ## Run offline integration tests with OTel tracing (Jaeger)
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
test-stress: check-runner-node ensure-service-jar ## Run offline integration tests 3x to detect flakes (no quarantine skip)
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
