# Security integration tests — JWT validation through the production security chain.
# These tests start the Java service WITHOUT STIGMER_SECURITY_MODE=test, using a mock
# OIDC server in place of Auth0. This exercises the real GrpcSecurityConfigBase
# interceptor chain, FederatedJwtAuthenticationProvider, and PlatformClientTokenAuth.
#
# Invoked from the repo root via: make test-integration-security
# Can also be run directly: cd test/integration-security && make test

# Disable Go workspace to avoid cross-module dependency conflicts (CI has no go.work).
export GOWORK := off

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
# Resolved separately so ensure-service-jar can tell whether the caller
# overrode the path (e.g. a CI prebuilt artifact) or left it at the default.
STIGMER_SERVICE_JAR_DEFAULT := $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar
STIGMER_SERVICE_JAR ?= $(STIGMER_SERVICE_JAR_DEFAULT)

OUTPUT_DIR ?= .test-output-security

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

.PHONY: test
test: ensure-service-jar ## Run security integration tests (JWT validation, production auth chain)
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
		-- -tags integration -timeout 300s -count=1 -v
