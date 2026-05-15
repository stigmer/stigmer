# Integration test targets for the Stigmer platform.
# Invoked from the repo root via: make test-integration, test-integration-providers, test-integration-agent
# Can also be run directly: cd test/integration && make test

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
STIGMER_SERVICE_JAR ?= $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar

OUTPUT_DIR          ?= .test-output
PROVIDER_OUTPUT_DIR ?= .test-output-providers
AGENT_OUTPUT_DIR    ?= .test-output-agent

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
		-- -tags integration -timeout 300s -count=1 ./...

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
		-- -tags integration -timeout 900s -count=1 -run 'TestWorkflow(LlmCall|AgentCall|CursorCall)|TestAgentExecution' ./...

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
		-- -tags integration -timeout 900s -count=1 -run 'TestAgentExecution' ./...
