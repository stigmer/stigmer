#!/bin/bash

# Test script for Golden Test 11: Claim Check Large Payload
# Assumes workflow-runner is running on localhost:9090

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

GRPC_HOST="${GRPC_HOST:-localhost:9090}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKFLOW_FILE="$SCRIPT_DIR/11-claimcheck-large-payload.yaml"

echo "======================================"
echo "Golden Test 11: Claim Check Large Payload"
echo "======================================"
echo ""

# Check if service is running
echo -e "${YELLOW}→ Checking if workflow-runner is running...${NC}"
if ! grpcurl -plaintext "$GRPC_HOST" grpc.health.v1.Health/Check > /dev/null 2>&1; then
    echo -e "${RED}✗ Service is NOT running on ${GRPC_HOST}${NC}"
    echo ""
    echo "Please start the service first:"
    echo "  cd ../.. && source .env_export && bazel run //backend/services/workflow-runner:workflow_runner"
    exit 1
fi
echo -e "${GREEN}✓ Service is running${NC}"
echo ""

# Display what we're testing
echo -e "${BLUE}Test Scenario:${NC}"
echo "This workflow fetches large datasets to test Claim Check pattern:"
echo "  1. Fetch all photos (~500KB) - Should trigger R2 offload"
echo "  2. Fetch all comments (~75KB) - Should trigger R2 offload"
echo "  3. Post summary - Regular payload"
echo ""
echo "Expected Behavior:"
echo "  - Both large payloads offloaded to R2"
echo "  - ClaimCheck.Offload activities visible in Temporal UI"
echo "  - R2 objects created with workflow ID"
echo "  - Compressed data stored in R2"
echo ""

# Read workflow
echo -e "${YELLOW}→ Reading workflow from ${WORKFLOW_FILE}${NC}"
if [ ! -f "$WORKFLOW_FILE" ]; then
    echo -e "${RED}✗ Workflow file not found: ${WORKFLOW_FILE}${NC}"
    exit 1
fi

WORKFLOW_YAML=$(cat "$WORKFLOW_FILE")
echo -e "${GREEN}✓ Workflow loaded${NC}"
echo ""

# Generate unique workflow ID
WORKFLOW_ID="claimcheck-large-payload-test-$(date +%s)"

# Execute workflow
echo -e "${YELLOW}→ Submitting workflow to ${GRPC_HOST}${NC}"
echo -e "${BLUE}Workflow ID: ${WORKFLOW_ID}${NC}"
echo ""

grpcurl -plaintext -d "{
  \"workflow_execution_id\": \"${WORKFLOW_ID}\",
  \"workflow_yaml\": $(echo "$WORKFLOW_YAML" | jq -Rs .)
}" "$GRPC_HOST" ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/execute_async

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Workflow submitted successfully!${NC}"
    echo ""
    echo "======================================"
    echo "Verification"
    echo "======================================"
    echo ""
    echo "1. Check Temporal UI:"
    echo "   ${BLUE}https://stigmer-prod-temporal.planton.live${NC}"
    echo "   Search for: ${WORKFLOW_ID}"
    echo ""
    echo "   Expected activities:"
    echo "   ✓ fetchLargeData (HTTP GET /photos)"
    echo "   ✓ ClaimCheck.Offload (for photos ~500KB)"
    echo "   ✓ fetchMoreData (HTTP GET /comments)"
    echo "   ✓ ClaimCheck.Offload (for comments ~75KB)"
    echo "   ✓ postSummary (HTTP POST)"
    echo ""
    echo "2. Check R2 Bucket:"
    echo "   Bucket: ${R2_BUCKET:-stigmer-prod-claimcheck-r2-bucket-manual}"
    echo "   Expected: 2 new objects (for photos and comments)"
    echo "   Object pattern: ${WORKFLOW_ID}-*"
    echo ""
    echo "3. Check workflow-runner logs:"
    echo "   Look for: '📦 Offloading data to R2'"
    echo "   Should appear twice (once for each large payload)"
    echo ""
    echo "Wait 10-30 seconds for workflow to complete, then check Temporal UI"
else
    echo ""
    echo -e "${RED}✗ Failed to submit workflow${NC}"
    exit 1
fi
