# Security integration tests — JWT validation through the production security chain.
# These tests start the Java service WITHOUT STIGMER_SECURITY_MODE=test, using a mock
# OIDC server in place of Auth0. This exercises the real GrpcSecurityConfigBase
# interceptor chain, FederatedJwtAuthenticationProvider, and PlatformClientTokenAuth.
#
# Invoked from the repo root via: make test-integration-security
# Can also be run directly: cd test/integration-security && make test

STIGMER_CLOUD_ROOT ?= $(CURDIR)/../../../stigmer-cloud
STIGMER_SERVICE_JAR ?= $(STIGMER_CLOUD_ROOT)/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar

OUTPUT_DIR ?= .test-output-security

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
