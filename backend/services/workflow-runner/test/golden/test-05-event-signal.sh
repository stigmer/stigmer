#!/bin/bash
set -e

# Test script for Golden Test 05: Event Signal
# Tests event-based state transitions and signal handling

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_FILE="$SCRIPT_DIR/05-event-signal.yaml"
GRPC_HOST="${GRPC_HOST:-localhost:9090}"

# Generate unique execution ID
EXECUTION_ID="event-signal-$(date +%s)"

echo "======================================"
echo "Golden Test 05: Event Signal"
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
    \"name\": \"Event Signal Test\",
    \"version\": \"1.0\",
    \"namespace\": \"golden-tests\",
    \"description\": \"Test event-based state transitions\"
  }
}" "$GRPC_HOST" ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/execute_async

echo ""
echo "======================================"
echo "✅ Workflow submitted successfully!"
echo ""
echo "Expected behavior:"
echo "  1. Workflow waits for event/signal"
echo "  2. Event triggers state transition"
echo "  3. Workflow continues execution"
echo ""
echo "Check Temporal UI for execution details:"
echo "Search for workflow ID: $EXECUTION_ID"
echo "======================================"
