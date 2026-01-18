#!/bin/bash
#
# Test Search Attribute Setup
#
# Quick test to verify the automated search attribute setup works.
# Runs against local Temporal instance.
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Search Attribute Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if temporal is running
echo -e "${BLUE}1. Checking Temporal connection...${NC}"
if temporal operator search-attribute list --namespace default --address localhost:7233 >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Temporal is reachable"
else
    echo -e "  ${YELLOW}!${NC} Temporal not reachable at localhost:7233"
    echo ""
    echo "Please start Temporal:"
    echo "  docker run -p 7233:7233 temporalio/auto-setup:latest"
    exit 1
fi

echo ""
echo -e "${BLUE}2. Testing automated setup script...${NC}"
cd "$(dirname "$0")"
if ./setup-temporal-search-attributes.sh default localhost:7233; then
    echo -e "  ${GREEN}✓${NC} Setup script completed successfully"
else
    echo -e "  ${YELLOW}!${NC} Setup script failed"
    exit 1
fi

echo ""
echo -e "${BLUE}3. Verifying search attribute exists...${NC}"
if temporal operator search-attribute list \
    --namespace default \
    --address localhost:7233 | grep -q "WorkflowExecutionID"; then
    echo -e "  ${GREEN}✓${NC} WorkflowExecutionID exists"
else
    echo -e "  ${YELLOW}!${NC} WorkflowExecutionID not found"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ All Tests Passed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Search attribute setup is working correctly."
echo ""
echo "Next steps:"
echo "  1. Start workflow-runner worker"
echo "  2. Watch for automatic setup logs:"
echo "     grep 'search attribute' logs"
