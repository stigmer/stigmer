#!/bin/bash

# Flakiness detection script for e2e tests
# Usage: ./run-flakiness-test.sh [num_runs] [test_name]
#
# Examples:
#   ./run-flakiness-test.sh 10                              # Run all tests 10 times
#   ./run-flakiness-test.sh 20 TestRunFullAgent            # Run specific test 20 times
#   ./run-flakiness-test.sh 5 "TestRunFullAgent|TestRunWithAutoDiscovery"  # Multiple tests

set -o pipefail

NUM_RUNS=${1:-10}
TEST_FILTER=${2:-"TestE2E"}
RESULTS_DIR="./test-results-$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="$RESULTS_DIR/summary.txt"

echo "========================================"
echo "E2E Test Flakiness Detection"
echo "========================================"
echo "Runs: $NUM_RUNS"
echo "Filter: $TEST_FILTER"
echo "Results: $RESULTS_DIR"
echo ""

mkdir -p "$RESULTS_DIR"

# Track results
PASS_COUNT=0
FAIL_COUNT=0
declare -a FAILED_RUNS

echo "Starting test runs..." | tee -a "$SUMMARY_FILE"
echo "" | tee -a "$SUMMARY_FILE"

for i in $(seq 1 $NUM_RUNS); do
  RUN_FILE="$RESULTS_DIR/run-$i.log"
  
  echo "----------------------------------------" | tee -a "$SUMMARY_FILE"
  echo "Run $i/$NUM_RUNS: $(date)" | tee -a "$SUMMARY_FILE"
  echo "----------------------------------------" | tee -a "$SUMMARY_FILE"
  
  # Run test with timeout
  if go test -v -tags=e2e ./test/e2e -run "$TEST_FILTER" -timeout 10m &> "$RUN_FILE"; then
    echo "✅ PASSED" | tee -a "$SUMMARY_FILE"
    ((PASS_COUNT++))
  else
    EXIT_CODE=$?
    echo "❌ FAILED (exit code: $EXIT_CODE)" | tee -a "$SUMMARY_FILE"
    ((FAIL_COUNT++))
    FAILED_RUNS+=($i)
    
    # Extract failure details
    echo "  Failure details:" | tee -a "$SUMMARY_FILE"
    grep -A 5 "FAIL:" "$RUN_FILE" | tee -a "$SUMMARY_FILE" || echo "  (no FAIL lines found)" | tee -a "$SUMMARY_FILE"
  fi
  
  echo "" | tee -a "$SUMMARY_FILE"
  
  # Small delay between runs
  sleep 1
done

echo "========================================"  | tee -a "$SUMMARY_FILE"
echo "FINAL RESULTS"  | tee -a "$SUMMARY_FILE"
echo "========================================"  | tee -a "$SUMMARY_FILE"
echo "Total runs:   $NUM_RUNS"  | tee -a "$SUMMARY_FILE"
echo "Passed:       $PASS_COUNT"  | tee -a "$SUMMARY_FILE"
echo "Failed:       $FAIL_COUNT"  | tee -a "$SUMMARY_FILE"

if [ $FAIL_COUNT -gt 0 ]; then
  FLAKE_RATE=$(awk "BEGIN {printf \"%.1f\", ($FAIL_COUNT/$NUM_RUNS)*100}")
  echo "Flake rate:   $FLAKE_RATE%"  | tee -a "$SUMMARY_FILE"
  echo ""  | tee -a "$SUMMARY_FILE"
  echo "Failed runs: ${FAILED_RUNS[*]}"  | tee -a "$SUMMARY_FILE"
  echo ""  | tee -a "$SUMMARY_FILE"
  echo "📋 Detailed logs available in: $RESULTS_DIR"  | tee -a "$SUMMARY_FILE"
  
  # Show common error patterns
  echo ""  | tee -a "$SUMMARY_FILE"
  echo "Common error patterns:"  | tee -a "$SUMMARY_FILE"
  for run in "${FAILED_RUNS[@]}"; do
    echo "  Run $run:" | tee -a "$SUMMARY_FILE"
    grep -E "(timeout|failed|error|FAIL)" "$RESULTS_DIR/run-$run.log" | head -5 | sed 's/^/    /' | tee -a "$SUMMARY_FILE"
  done
  
  exit 1
else
  echo "🎉 All tests passed! No flakiness detected."  | tee -a "$SUMMARY_FILE"
  exit 0
fi
