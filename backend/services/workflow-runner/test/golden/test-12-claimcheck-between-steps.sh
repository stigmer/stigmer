#!/bin/bash

# Test script for Golden Test 12: Claim Check Between Steps
# Tests that large data is offloaded BETWEEN steps, not just at workflow end
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
WORKFLOW_FILE="$SCRIPT_DIR/12-claimcheck-between-steps.yaml"

echo "======================================"
echo "Golden Test 12: Claim Check Between Steps"
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
echo "This workflow tests step-by-step Claim Check offloading:"
echo "  1. Fetch photos (~500KB) → Offload to R2 AFTER step"
echo "  2. Fetch comments (~75KB) → Auto-retrieve photos, execute, offload comments"
echo "  3. Process combined → Auto-retrieve both, execute, offload result"
echo "  4. Verify data access → Prove all data is still accessible"
echo ""
echo "Expected Behavior:"
echo "  ✓ Photos offloaded after Step 1"
echo "  ✓ Photos auto-retrieved before Step 2"
echo "  ✓ Comments offloaded after Step 2"
echo "  ✓ Both datasets auto-retrieved before Step 3"
echo "  ✓ All activities execute successfully"
echo "  ✓ Final result shows all data accessible"
echo ""
echo -e "${YELLOW}Key Test Point:${NC}"
echo "  Without step-by-step offloading, Step 2 would FAIL with:"
echo "  'ScheduleActivityTaskCommandAttributes.Input exceeds size limit'"
echo "  (because 500KB photos would be passed to activity input)"
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
WORKFLOW_ID="claimcheck-between-steps-$(date +%s)"

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
    echo "   Expected activity sequence:"
    echo "   ✓ fetchPhotos (HTTP GET)"
    echo "   ✓ ClaimCheck.Offload (photos ~500KB)"
    echo "   ✓ ClaimCheck.Retrieve (photos before next step)"
    echo "   ✓ fetchComments (HTTP GET)"
    echo "   ✓ ClaimCheck.Offload (comments ~75KB)"
    echo "   ✓ ClaimCheck.Retrieve (both datasets)"
    echo "   ✓ processCombined (HTTP POST)"
    echo "   ✓ ClaimCheck.Retrieve (if needed)"
    echo "   ✓ verifyDataAccess (HTTP POST)"
    echo ""
    echo "2. Check R2 Bucket:"
    echo "   Bucket: ${R2_BUCKET:-stigmer-prod-claimcheck-r2-bucket-manual}"
    echo "   Expected: Multiple objects (one per offload)"
    echo "   Pattern: UUID keys with workflow metadata"
    echo ""
    echo "3. Check workflow-runner logs:"
    echo "   Look for:"
    echo "   - 'Offloading large state field' (after steps)"
    echo "   - 'Retrieving offloaded state field' (before activities)"
    echo ""
    echo "4. Verify workflow completes:"
    echo "   Status should be: COMPLETED"
    echo "   NOT: FAILED with 'Input exceeds size limit'"
    echo ""
    echo "Wait 30-60 seconds for workflow to complete, then check Temporal UI"
    echo ""
    echo -e "${GREEN}Success Criteria:${NC}"
    echo "  ✓ Workflow completes without 'size limit' errors"
    echo "  ✓ Multiple ClaimCheck.Offload activities visible"
    echo "  ✓ ClaimCheck.Retrieve activities before each step"
    echo "  ✓ Final POST shows all data was accessible"
else
    echo ""
    echo -e "${RED}✗ Failed to submit workflow${NC}"
    exit 1
fi
