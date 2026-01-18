#!/bin/bash
#
# Setup Temporal Search Attributes
#
# This script automatically creates required search attributes in Temporal.
# It's idempotent and safe to run multiple times.
#
# Usage:
#   ./setup-temporal-search-attributes.sh [namespace] [temporal-address]
#
# Examples:
#   # Local development
#   ./setup-temporal-search-attributes.sh default localhost:7233
#
#   # Production
#   ./setup-temporal-search-attributes.sh stigmer stigmer-prod-temporal-frontend.planton.live:7233
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
NAMESPACE="${1:-${TEMPORAL_NAMESPACE:-default}}"
TEMPORAL_ADDRESS="${2:-${TEMPORAL_SERVICE_ADDRESS:-localhost:7233}}"

# Required search attributes
declare -A REQUIRED_ATTRS=(
    ["WorkflowExecutionID"]="Text"
)

# Descriptions for each attribute
declare -A ATTR_DESCRIPTIONS=(
    ["WorkflowExecutionID"]="Stores WorkflowExecutionID for progress reporting (execution ID propagation)"
)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Temporal Search Attributes Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Namespace: ${YELLOW}$NAMESPACE${NC}"
echo -e "Address:   ${YELLOW}$TEMPORAL_ADDRESS${NC}"
echo ""

# Check if temporal CLI is installed
if ! command -v temporal &> /dev/null; then
    echo -e "${RED}ERROR: temporal CLI not found${NC}"
    echo ""
    echo "Please install temporal CLI:"
    echo "  macOS:   brew install temporal"
    echo "  Linux:   curl -sSf https://temporal.download/cli.sh | sh"
    echo "  Windows: scoop install temporal-cli"
    exit 1
fi

echo -e "${BLUE}Checking existing search attributes...${NC}"

# List existing search attributes
EXISTING_ATTRS=$(temporal operator search-attribute list \
    --namespace "$NAMESPACE" \
    --address "$TEMPORAL_ADDRESS" \
    2>/dev/null || echo "")

if [ -z "$EXISTING_ATTRS" ]; then
    echo -e "${RED}ERROR: Failed to list search attributes${NC}"
    echo "Possible issues:"
    echo "  - Temporal server not reachable at $TEMPORAL_ADDRESS"
    echo "  - Namespace '$NAMESPACE' doesn't exist"
    echo "  - Authentication required but not provided"
    exit 1
fi

# Track what needs to be created
MISSING_ATTRS=()
EXISTING_COUNT=0
CREATED_COUNT=0

# Check each required attribute
for attr_name in "${!REQUIRED_ATTRS[@]}"; do
    attr_type="${REQUIRED_ATTRS[$attr_name]}"
    attr_desc="${ATTR_DESCRIPTIONS[$attr_name]}"
    
    # Check if attribute exists in output
    if echo "$EXISTING_ATTRS" | grep -q "^[[:space:]]*$attr_name"; then
        echo -e "  ${GREEN}✓${NC} $attr_name ($attr_type) - exists"
        ((EXISTING_COUNT++)) || true
    else
        echo -e "  ${YELLOW}!${NC} $attr_name ($attr_type) - missing"
        MISSING_ATTRS+=("$attr_name:$attr_type:$attr_desc")
    fi
done

echo ""

# Create missing attributes
if [ ${#MISSING_ATTRS[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All required search attributes exist${NC}"
    exit 0
fi

echo -e "${BLUE}Creating missing search attributes...${NC}"

for attr_info in "${MISSING_ATTRS[@]}"; do
    IFS=':' read -r attr_name attr_type attr_desc <<< "$attr_info"
    
    echo -e "${YELLOW}Creating: $attr_name ($attr_type)${NC}"
    echo -e "  Purpose: $attr_desc"
    
    # Create search attribute
    if temporal operator search-attribute create \
        --namespace "$NAMESPACE" \
        --address "$TEMPORAL_ADDRESS" \
        --name "$attr_name" \
        --type "$attr_type" \
        2>&1 | tee /tmp/temporal_attr_output.log; then
        
        # Check if already exists (race condition or previous partial run)
        if grep -qi "already exists\|already registered" /tmp/temporal_attr_output.log; then
            echo -e "  ${GREEN}✓${NC} Already exists (created by another process)"
        else
            echo -e "  ${GREEN}✓${NC} Created successfully"
        fi
        ((CREATED_COUNT++)) || true
    else
        # Check if error is because it already exists
        if grep -qi "already exists\|already registered" /tmp/temporal_attr_output.log; then
            echo -e "  ${GREEN}✓${NC} Already exists (race condition)"
            ((CREATED_COUNT++)) || true
        else
            echo -e "  ${RED}✗${NC} Failed to create"
            echo -e "${RED}ERROR: Failed to create search attribute $attr_name${NC}"
            cat /tmp/temporal_attr_output.log
            exit 1
        fi
    fi
    
    echo ""
done

# Clean up temp file
rm -f /tmp/temporal_attr_output.log

# Final summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Setup Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Summary:"
echo "  Existing:  $EXISTING_COUNT"
echo "  Created:   $CREATED_COUNT"
echo "  Total:     $((EXISTING_COUNT + CREATED_COUNT))"
echo ""
echo -e "${GREEN}All required search attributes are now available!${NC}"
echo ""
echo "You can verify with:"
echo "  temporal operator search-attribute list \\"
echo "    --namespace $NAMESPACE \\"
echo "    --address $TEMPORAL_ADDRESS"
