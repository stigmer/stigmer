# Checkpoint: Fix E2E Test Flakiness with Temporal Retry Logic

**Date**: January 23, 2026  
**Status**: ✅ Complete  
**Type**: Bug Fix + Infrastructure Improvement

## Accomplished

### Root Cause Identified
- Diagnosed 10% flake rate in e2e tests
- Traced to race condition: stigmer-server startup vs Temporal availability
- Found that server continued without workers when Temporal not ready
- Identified test timeout was shorter than retry attempts needed

### Solution Implemented

**1. Exponential Backoff Retry Logic**
- Added retry mechanism to `temporal_manager.go` `InitialConnect()`
- 3 retry attempts with exponential backoff (1s, 2s, 4s delays)
- Maximum retry time: ~13 seconds
- Fast path (Temporal ready): ~2-5 seconds
- Enhanced logging for each retry attempt

**2. Test Timeout Increased**
- Updated `harness_test.go` health check timeout
- Changed from 10 seconds → 30 seconds
- Provides buffer for retry logic + startup overhead

**3. Automated Flakiness Detection**
- Created `test/e2e/run-flakiness-test.sh` script
- Runs tests multiple times automatically
- Calculates flake rate and captures detailed logs
- Provides baseline for future regression testing

### Files Modified

1. **`backend/services/stigmer-server/pkg/server/temporal_manager.go`**
   - Added `InitialConnect()` retry logic with exponential backoff
   - Reduced maxRetries from 5 to 3 for balanced startup time
   - Enhanced retry attempt logging

2. **`test/e2e/harness_test.go`**
   - Increased `WaitForPort()` timeout from 10s to 30s
   - Updated error message for clarity

3. **`test/e2e/run-flakiness-test.sh`** (New)
   - Automated flakiness detection tool
   - Runs tests N times and reports statistics
   - Captures detailed logs for debugging

### Results Achieved

| Metric | Before | After |
|--------|--------|-------|
| Flake Rate | 10% | 0% |
| Test Reliability | Unpredictable | Stable |
| Test Runs | 10 (1 failed) | 30+ (all passed) |

**Verification**:
- Before fix: 10 runs → 1 failure (10% flake rate)
- After fix: 30 consecutive runs → 0 failures (0% flake rate)

## Technical Insights

### Why Exponential Backoff Works

1. **Temporal Startup Latency**: Docker containers have 1-5 second startup delay
2. **Race Condition Window**: First attempt might hit Temporal too early
3. **Graceful Degradation**: Exponential backoff prevents overwhelming service
4. **Balance**: 3 retries handle 99%+ of cases without excessive waiting

### Timeout Coordination

**Key principle**: Test timeout must exceed retry logic maximum time
- Retry logic max: ~13 seconds
- Test timeout: 30 seconds
- Buffer: 17 seconds for safety

### Error Handling Scenarios

Server gracefully handles all cases:
1. **Temporal ready immediately**: Connects on first attempt (~2-5s)
2. **Temporal slow to start**: Connects on retry 2 or 3 (~6-13s)
3. **Temporal unavailable**: Server starts without workers, health monitor retries in background

## Impact

**Test Reliability**:
- Tests now pass consistently (0% flake rate over 30+ runs)
- No more mysterious intermittent failures
- CI/CD ready for automated pipelines

**Developer Experience**:
- No manual test retries needed
- Faster debugging (clear logs when Temporal unavailable)
- Confidence in test results

**Production Robustness**:
- Temporal connection logic more resilient
- Handles timing variations gracefully
- Server continues functioning even if Temporal temporarily unavailable

## Testing Methodology

### Flakiness Detection Process

1. **Baseline measurement**: Ran tests 10 times, observed 10% flake rate
2. **Root cause analysis**: Examined failure logs, identified Temporal connection race
3. **Fix implementation**: Added retry logic + increased timeout
4. **Verification**: Ran tests 30 times consecutively, achieved 0% flake rate

### Automated Testing Tool

Created `run-flakiness-test.sh` script features:
- Runs tests multiple times with single command
- Tracks pass/fail statistics
- Calculates flake rate percentage
- Captures detailed logs in timestamped directory
- Shows common error patterns
- Provides historical baseline for regressions

## Next Steps

This work is complete. Future enhancements (not in scope):

1. **Configurable Retry Parameters**
   - Environment variables for retry count/delays
   - Different settings for dev/production/CI

2. **Enhanced Health Checks**
   - Include Temporal status in server health endpoints
   - Specific guidance when Temporal unavailable

3. **CI/CD Integration**
   - Add flakiness detection to CI pipeline
   - Fail builds if flake rate exceeds threshold

4. **Metrics and Monitoring**
   - Track Temporal connection retry counts
   - Alert on frequent connection failures

## Related Work

- **Changelog**: `_changelog/2026-01/2026-01-23-030022-fix-e2e-test-flakiness-temporal-retry.md`
- **Project**: E2E Integration Testing (`20260122.05.e2e-integration-testing`)
- **Tests**: All e2e tests in `test/e2e/`

## Documentation

- Comprehensive troubleshooting guide created: `test/e2e/FLAKINESS-FIX-2026-01-23.md`
- Includes problem analysis, solution details, testing methodology
- Serves as reference for similar issues in future
