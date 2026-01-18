#!/bin/bash
set -e

# Test script for Golden Test 08: Error Retry
# Tests error handling and retry mechanisms

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_FILE="$SCRIPT_DIR/08-error-retry.yaml"
GRPC_HOST="${GRPC_HOST:-localhost:9090}"

# Generate unique execution ID
EXECUTION_ID="error-retry-$(date +%s)"

echo "======================================"
echo "Golden Test 08: Error Retry"
echo "======================================"
echo "Workflow File: $WORKFLOW_FILE"
echo "gRPC Endpoint: $GRPC_HOST"
echo "Execution ID: $EXECUTION_ID"
echo ""

# Check if service is running
echo "→ Checking if workflow-runner is running..."
if ! grpcurl -plaintext "$GRPC_HOST" grpc.health.v1.Health/Check > /dev/null 2>&1; then
    echo "✗ Service is NOT running on ${GRPC_HOST}"
    echo ""
    echo "Please start the service first:"
    echo "  cd ../.. && source .env_export && bazel run //backend/services/workflow-runner:workflow_runner"
    exit 1
fi
echo "✓ Service is running"
echo ""

# Read workflow YAML content
if [ ! -f "$WORKFLOW_FILE" ]; then
    echo "✗ Workflow file not found: $WORKFLOW_FILE"
    exit 1
fi

WORKFLOW_YAML=$(cat "$WORKFLOW_FILE")

# Execute workflow via gRPC
echo "→ Executing workflow via gRPC..."
echo ""

grpcurl -plaintext -d "{
  \"workflow_execution_id\": \"$EXECUTION_ID\",
  \"workflow_yaml\": $(echo "$WORKFLOW_YAML" | jq -Rs .),
  \"metadata\": {
    \"name\": \"Error Retry Test\",
    \"version\": \"1.0\",
    \"namespace\": \"golden-tests\",
    \"description\": \"Test error handling and retry mechanisms\"
  }
}" "$GRPC_HOST" ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/execute_async

echo ""
echo "======================================"
echo "✅ Workflow submitted successfully!"
echo ""
echo "Expected behavior:"
echo "  1. Execute operation that may fail"
echo "  2. On failure, retry with configured policy"
echo "  3. Either succeed after retry or handle error"
echo ""
echo "Check Temporal UI for execution details:"
echo "Search for workflow ID: $EXECUTION_ID"
echo "Look for retry attempts in the execution history"
echo "======================================"
