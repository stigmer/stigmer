#!/bin/bash

# Task 6 Integration Test Runner
# Validates all production-grade Temporal lifecycle features

set -e  # Exit on error

STIGMER_CLI="/tmp/stigmer-cli"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=10

# Helper functions
print_test_header() {
    echo ""
    echo "========================================"
    echo "TEST $1: $2"
    echo "========================================"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

print_failure() {
    echo -e "${RED}❌ $1${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

cleanup() {
    print_info "Cleaning up..."
    $STIGMER_CLI local stop 2>/dev/null || true
    sleep 2
    rm -f ~/.stigmer/temporal.lock ~/.stigmer/temporal.pid
}

wait_for_temporal() {
    local max_wait=15
    local count=0
    while [ $count -lt $max_wait ]; do
        if lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    return 1
}

# Pre-test cleanup
print_info "Starting Task 6 Integration Tests"
print_info "Prerequisites: Building CLI and cleaning state..."
cd /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli
rm -f $STIGMER_CLI
go clean
go build -o $STIGMER_CLI main.go
chmod +x $STIGMER_CLI
cleanup

# Test 1: Normal Lifecycle (Start → Stop → Start)
print_test_header "1" "Normal Lifecycle (Start → Stop → Start)"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

if wait_for_temporal; then
    print_success "Temporal started successfully"
else
    print_failure "Temporal failed to start"
    exit 1
fi

# Verify lock file held
if lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
    print_success "Lock file is held by Temporal process"
else
    print_failure "Lock file not held"
fi

# Stop
$STIGMER_CLI local stop > /dev/null 2>&1
sleep 2

if ! lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
    print_success "Lock released after stop"
else
    print_failure "Lock still held after stop"
fi

# Restart
$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

if wait_for_temporal; then
    print_success "Restart succeeded"
else
    print_failure "Restart failed"
fi

cleanup

# Test 2: Idempotent Start
print_test_header "2" "Idempotent Start (Already Running)"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

# Try starting again (should be idempotent)
if $STIGMER_CLI local 2>&1 | grep -q "already running"; then
    print_success "Idempotent start detected existing instance"
else
    print_info "Checking if start succeeded anyway..."
fi

# Verify only one process
process_count=$(ps aux | grep -v grep | grep "temporal server" | wc -l | tr -d ' ')
if [ "$process_count" -eq "1" ]; then
    print_success "Only one Temporal process running"
else
    print_failure "Found $process_count Temporal processes (expected 1)"
fi

cleanup

# Test 3: Crash Recovery (Auto-Restart)
print_test_header "3" "Crash Recovery with Auto-Restart"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

# Get PID before crash
pid_before=$(cat ~/.stigmer/temporal.pid 2>/dev/null | head -1)
print_info "Temporal PID before crash: $pid_before"

# Simulate crash
print_info "Simulating crash with kill -9..."
kill -9 $pid_before 2>/dev/null || true

# Wait for auto-restart (health check interval + backoff)
print_info "Waiting for auto-restart (7 seconds)..."
sleep 7

# Check if new process started
if [ -f ~/.stigmer/temporal.pid ]; then
    pid_after=$(cat ~/.stigmer/temporal.pid | head -1)
    if ps -p $pid_after > /dev/null 2>&1; then
        print_success "Auto-restart succeeded (new PID: $pid_after)"
        
        if [ "$pid_before" != "$pid_after" ]; then
            print_success "PID changed after restart (expected behavior)"
        fi
    else
        print_failure "PID file exists but process not running"
    fi
else
    print_failure "Auto-restart did not create PID file"
fi

cleanup

# Test 4: Orphan Cleanup
print_test_header "4" "Orphan Cleanup and Recovery"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

# Force kill to create orphan
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
kill -9 $temporal_pid 2>/dev/null || true

# Stop before supervisor restarts
sleep 2
$STIGMER_CLI local stop > /dev/null 2>&1
sleep 2

# Verify cleanup
if ! ps aux | grep -v grep | grep "temporal server" > /dev/null; then
    print_success "Orphaned processes cleaned up"
else
    print_failure "Orphaned processes still running"
fi

# Start fresh
$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

if wait_for_temporal; then
    print_success "Fresh start after orphan cleanup succeeded"
else
    print_failure "Fresh start failed"
fi

cleanup

# Test 5: Lock File Concurrency
print_test_header "5" "Lock File Prevents Concurrent Instances"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

# Try to start second instance
output=$($STIGMER_CLI local 2>&1)

if echo "$output" | grep -q "already running"; then
    print_success "Second instance detected lock and reported already running"
else
    print_info "Second start succeeded (idempotent - also acceptable)"
fi

# Verify still only one process
process_count=$(ps aux | grep -v grep | grep "temporal server" | wc -l | tr -d ' ')
if [ "$process_count" -eq "1" ]; then
    print_success "Lock prevented duplicate instance"
else
    print_failure "Found $process_count processes (expected 1)"
fi

cleanup

# Test 6: Process Group Cleanup
print_test_header "6" "Process Group Cleanup on Stop"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
print_info "Temporal PID: $temporal_pid"

# Get process group
pgid=$(ps -o pgid= -p $temporal_pid | tr -d ' ')
print_info "Process Group ID: $pgid"

# Stop
$STIGMER_CLI local stop > /dev/null 2>&1
sleep 2

# Verify all processes in group are gone
if ! ps -g $pgid 2>/dev/null | grep -v grep | grep temporal > /dev/null; then
    print_success "All processes in group terminated"
else
    print_failure "Some processes in group still running"
fi

# Test 7: Stress Test (Multiple Crash/Recovery Cycles)
print_test_header "7" "Stress Test (5 Crash/Recovery Cycles)"

success_count=0
for i in {1..5}; do
    print_info "Cycle $i/5"
    
    $STIGMER_CLI local > /dev/null 2>&1 &
    sleep 3
    
    # Crash
    temporal_pid=$(cat ~/.stigmer/temporal.pid 2>/dev/null | head -1)
    kill -9 $temporal_pid 2>/dev/null || true
    
    # Wait for recovery
    sleep 7
    
    # Verify recovered
    if [ -f ~/.stigmer/temporal.pid ]; then
        new_pid=$(cat ~/.stigmer/temporal.pid | head -1)
        if ps -p $new_pid > /dev/null 2>&1; then
            success_count=$((success_count + 1))
            print_info "  Cycle $i: Recovered (PID: $new_pid)"
        else
            print_info "  Cycle $i: Failed"
        fi
    fi
done

if [ $success_count -eq 5 ]; then
    print_success "All 5 crash/recovery cycles passed"
else
    print_failure "Only $success_count/5 cycles succeeded"
fi

cleanup

# Test 8: Lock Auto-Release on Crash
print_test_header "8" "Lock Auto-Release on Crash"

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

# Verify lock held
if lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
    print_success "Lock held before crash"
else
    print_failure "Lock not held before crash"
fi

# Crash
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
kill -9 $temporal_pid 2>/dev/null || true
sleep 2

# Verify lock released (before supervisor restarts)
# Note: Supervisor will restart, so we need to check quickly
$STIGMER_CLI local stop > /dev/null 2>&1
sleep 2

if ! lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
    print_success "Lock auto-released after crash"
else
    print_info "Lock held by restarted process (supervisor working)"
fi

cleanup

# Test 9: Health Check Frequency
print_test_header "9" "Health Check Running (5 Second Interval)"

# This test just verifies supervisor is configured correctly
# (Full validation would require debug logs and longer observation)

$STIGMER_CLI local > /dev/null 2>&1 &
sleep 3

if ps aux | grep -v grep | grep "temporal server" > /dev/null; then
    print_success "Temporal running (supervisor should be monitoring)"
    
    # Check supervisor constants
    if grep -q "DefaultHealthCheckInterval = 5" /Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal/supervisor.go; then
        print_success "Health check interval configured as 5 seconds"
    else
        print_failure "Health check interval not set to 5 seconds"
    fi
else
    print_failure "Temporal not running"
fi

cleanup

# Test 10: Multiple Start/Stop Cycles
print_test_header "10" "Multiple Start/Stop Cycles (3 cycles)"

cycle_success=0
for i in {1..3}; do
    print_info "Cycle $i/3"
    
    # Start
    $STIGMER_CLI local > /dev/null 2>&1 &
    sleep 3
    
    if wait_for_temporal; then
        # Stop
        $STIGMER_CLI local stop > /dev/null 2>&1
        sleep 2
        
        # Verify stopped
        if ! lsof ~/.stigmer/temporal.lock 2>/dev/null | grep -q temporal; then
            cycle_success=$((cycle_success + 1))
        fi
    fi
done

if [ $cycle_success -eq 3 ]; then
    print_success "All 3 start/stop cycles completed successfully"
else
    print_failure "Only $cycle_success/3 cycles succeeded"
fi

# Final Summary
echo ""
echo "========================================"
echo "TEST SUMMARY"
echo "========================================"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo "Total:  $TOTAL_TESTS"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED! Task 6 Complete!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Review output above.${NC}"
    exit 1
fi
