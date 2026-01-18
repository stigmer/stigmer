#!/bin/bash
set -e

# Test script for 02-switch-conditional.yaml
# Usage: ./test-02-switch-conditional.sh [postId]
# Example: ./test-02-switch-conditional.sh 7
#
# The workflow will:
# 1. Fetch post data from https://jsonplaceholder.typicode.com/posts/{postId}
# 2. Extract userId from the response
# 3. Branch based on userId value:
#    - userId > 5: high_value_user path
#    - userId <= 5: regular_user path

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_FILE="$SCRIPT_DIR/02-switch-conditional.yaml"
GRPC_HOST="${GRPC_HOST:-localhost:9090}"

# Get post ID from argument or use default (7 has userId=1, 75 has userId=8)
POST_ID="${1:-7}"

# Generate unique execution ID
EXECUTION_ID="switch-test-$(date +%s)"

echo "=================================="
echo "Switch Conditional Workflow Test"
echo "=================================="
echo "Workflow File: $WORKFLOW_FILE"
echo "gRPC Endpoint: $GRPC_HOST"
echo "Execution ID: $EXECUTION_ID"
echo "Post ID: $POST_ID"
echo ""

# Fetch the post to show what data will be used
echo "Fetching post data..."
POST_DATA=$(curl -s "https://jsonplaceholder.typicode.com/posts/$POST_ID")
USER_ID=$(echo "$POST_DATA" | jq -r '.userId')
echo "Post $POST_ID has userId: $USER_ID"
echo ""

# Read workflow YAML content
if [ ! -f "$WORKFLOW_FILE" ]; then
    echo "❌ Error: Workflow file not found: $WORKFLOW_FILE"
    exit 1
fi

WORKFLOW_YAML=$(cat "$WORKFLOW_FILE")

# Execute workflow via gRPC
echo "Executing workflow via gRPC..."
echo ""

grpcurl -plaintext -d "{
  \"workflow_execution_id\": \"$EXECUTION_ID\",
  \"workflow_yaml\": $(echo "$WORKFLOW_YAML" | jq -Rs .),
  \"workflow_input\": {
    \"postId\": $POST_ID
  },
  \"metadata\": {
    \"name\": \"Switch Conditional Test\",
    \"version\": \"1.0\",
    \"namespace\": \"test\",
    \"description\": \"Test conditional branching with switch statement (postId=$POST_ID)\"
  }
}" "$GRPC_HOST" ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/execute_async

echo ""
echo "=================================="
echo "✅ Workflow execution started!"
echo ""
echo "Expected behavior for userId=$USER_ID:"
if [ "$USER_ID" -gt 5 ]; then
    echo "  → Should transition to 'high_value_user' state"
    echo "  → Should POST to jsonplaceholder.typicode.com with category='premium'"
elif [ "$USER_ID" -le 5 ] && [ "$USER_ID" -ge 1 ]; then
    echo "  → Should transition to 'regular_user' state"
    echo "  → Should POST to jsonplaceholder.typicode.com with category='standard'"
else
    echo "  → Should transition to 'unknown_user' state (fallback)"
fi
echo ""
echo "Workflow flow:"
echo "  1. GET https://jsonplaceholder.typicode.com/posts/$POST_ID"
echo "  2. Extract userId from response"
echo "  3. Branch based on userId value"
echo "  4. POST classification result"
echo ""
echo "Check Temporal UI: http://localhost:8233"
echo "Search for workflow ID: $EXECUTION_ID"
echo ""
echo "Test different paths:"
echo "  ./test-02-switch-conditional.sh 7   # userId=1 (regular user)"
echo "  ./test-02-switch-conditional.sh 75  # userId=8 (high value user)"
echo "=================================="
