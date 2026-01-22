# Add Production-Grade Health Monitoring & Auto-Restart

**Date**: 2026-01-22  
**Type**: Feature  
**Component**: daemon, health  
**Status**: ✅ Complete

## Overview

Implemented Kubernetes-inspired health monitoring and automatic restart for all stigmer daemon components. Eliminates silent failures and ensures production-grade reliability with automatic recovery from crashes.

## Problem Solved

**Before:**
- Process crashes went undetected (silent failures)
- No automatic recovery from crashes
- Users experienced "workflow timeout" errors
- Manual intervention required to restart components
- Root cause: Only checked if `cmd.Start()` succeeded, no continuous monitoring

**After:**
- Watchdog loop monitors all components every 10 seconds
- Crashed components automatically restart with exponential backoff
- Status command shows health, uptime, and restart counts
- No silent failures - all crashes logged and recovered
- Restart limits prevent infinite loops (max 10 restarts in 10 minutes)

## Implementation

### 1. Health Monitoring Package

Created new `client-apps/cli/internal/cli/health/` package with Kubernetes-inspired architecture:

**Core Components:**
- `types.go` - Health probe types, component states, restart policies
- `component.go` - Component health tracking and restart logic
- `monitor.go` - Watchdog loop that monitors all components
- `checks.go` - Component-specific health check implementations
- `README.md` - Comprehensive documentation

**Probe Types:**
```
Startup Probe   → Checks if component started successfully (30s tolerance)
Liveness Probe  → Checks if component is alive (triggers restart on failure)
Readiness Probe → Checks if component can handle work (doesn't trigger restart)
```

**Component States:**
```
StateStarting   → Component is starting up
StateRunning    → Component is healthy  
StateUnhealthy  → Component failed health checks
StateRestarting → Component is being restarted
StateStopped    → Component is stopped
StateFailed     → Component exceeded restart limits
```

**Restart Configuration:**
```go
MaxRestarts:       10                    // Max 10 restarts
RestartWindow:     10 * time.Minute      // Within 10 minutes
MinUptime:         10 * time.Second      // Must run 10s to be stable
InitialBackoff:    1 * time.Second       // Start with 1s backoff
MaxBackoff:        60 * time.Second      // Cap at 60s backoff
BackoffMultiplier: 2.0                   // Exponential: 1s, 2s, 4s, 8s...
```

### 2. Component-Specific Health Checks

**Stigmer Server:**
- PID check (process alive)
- gRPC port connectivity check (localhost:50051)
- Combined check ensures both process and server are responding

**Workflow Runner:**
- PID check (process alive)
- Minimum uptime validation (10s to avoid crash loop detection)

**Agent Runner (Docker):**
- Container running check (`docker ps`)
- Container health status check (if healthcheck defined)

### 3. Daemon Integration

Created `health_integration.go` with:
- Component registration and configuration
- Restart function implementations
- Startup configuration persistence

**New Files:**
- `daemon/health_integration.go` - Health monitoring integration
- `daemon/startup_config.go` - Config persistence for component restarts

**Modified Files:**
- `daemon/daemon.go` - Start/stop health monitoring, save/load config
- `cmd/stigmer/root/server.go` - Enhanced status command

### 4. Startup Configuration Persistence

**Challenge:** To restart individual components, we need their original startup configuration.

**Solution:** Save startup config to `startup-config.json`:
```json
{
  "data_dir": "/path/to/data",
  "log_dir": "/path/to/logs",
  "temporal_addr": "localhost:7233",
  "llm_provider": "ollama",
  "llm_model": "qwen2.5-coder:7b",
  "execution_mode": "local",
  "sandbox_image": "...",
  "stigmer_server_pid": 12345,
  "workflow_runner_pid": 12346,
  "agent_runner_container_id": "abc123..."
}
```

This allows health monitor to restart components with identical configuration.

### 5. Enhanced Status Command

**Old Output:**
```
Stigmer Server Status:
  Status: ✓ Running
  PID:    12345
  Port:   50051
```

**New Output:**
```
Stigmer Server Status:
─────────────────────────────────────

Stigmer Server:
  Status:   Running ✓
  PID:      12345
  Uptime:   2h 15m
  Restarts: 0

Workflow Runner:
  Status:   Running ✓
  PID:      12346
  Uptime:   2h 15m
  Restarts: 0

Agent Runner (Docker):
  Status:   Running ✓
  Container: abc123456789
  Uptime:   2h 14m
  Restarts: 0

Server Details:
  Port:   50051
  Data:   /Users/user/.stigmer

LLM Configuration:
  Provider: Local ✓ Running
  Model:    qwen2.5-coder:7b

Web UI:
  Temporal:  http://localhost:8233

Health Monitoring: ✓ Active
```

**Status Indicators:**
- `✓` Running (green)
- `↻` Starting/Restarting (yellow)
- `✗` Unhealthy (red)
- `✗✗` Failed permanently (red)
- `○` Stopped (gray)

### 6. Log File Consolidation

**Problem:** 
- Components logged to `.log` and `.err` files separately
- Confusing - `.err` contained all logs (Unix stderr convention), not just errors
- Different components logged to different streams inconsistently

**Solution:**
- All components now write both stdout and stderr to single `.log` file
- Clearer - everything in one place
- Consistent across all processes

**Changes:**
- `stigmer-server.log` + `stigmer-server.err` → `stigmer-server.log` (combined)
- `workflow-runner.log` + `workflow-runner.err` → `workflow-runner.log` (combined)
- Updated error messages to reference single log file

## Technical Details

### Watchdog Loop

Runs continuously in background goroutine:

```
Every 10 seconds:
  For each component:
    1. Run health check (with timeout)
    2. Update health status
    3. Check if restart needed
    4. If yes:
       a. Calculate backoff delay
       b. Wait for backoff
       c. Execute restart
       d. Track restart count
```

### Exponential Backoff

Prevents restart storms:

```
Restart 1: 1s delay
Restart 2: 2s delay
Restart 3: 4s delay
Restart 4: 8s delay
Restart 5: 16s delay
Restart 6: 32s delay
Restart 7+: 60s delay (capped)
```

### Restart Limits

Component enters `StateFailed` after:
- 10 restarts within 10 minute window
- Manual intervention required to recover

**Why:** Prevent infinite loops, detect persistent failures vs. transient issues.

### Minimum Uptime

Component must run for 10 seconds before restart is considered successful:

```
Component starts → Crashes after 5s → Restart failed (counter increments)
Component starts → Runs 15s → Crash → Restart successful (counter resets)
```

**Why:** Distinguish startup failures from runtime failures.

## Workflow

### Normal Operation

```
Component starts
  ↓
Health monitoring begins
  ↓
Startup probe checks (every 1s, 30s tolerance)
  ↓
Startup complete → Liveness probe takes over (every 10s)
  ↓
Component runs healthy → No action needed
```

### Failure & Recovery

```
Component crashes
  ↓
Liveness probe fails 3 times (30 seconds)
  ↓
Component marked unhealthy
  ↓
Watchdog calculates backoff (1s, 2s, 4s...)
  ↓
Wait for backoff
  ↓
Restart component with saved config
  ↓
Reset to starting state
  ↓
Startup probe checks again
```

### Permanent Failure

```
Component crashes repeatedly
  ↓
10 restarts within 10 minutes
  ↓
Component enters StateFailed
  ↓
Logs prominent error
  ↓
Manual intervention required
```

## Testing

To test health monitoring:

```bash
# Start server
stigmer server

# Check initial status
stigmer server status

# Simulate crash (kill a component)
pkill -f "workflow-runner"

# Watch auto-restart in logs
tail -f ~/.stigmer/logs/workflow-runner.log

# Check status to see restart count
stigmer server status
```

## Files Added

```
client-apps/cli/internal/cli/health/
├── types.go              # Health types and probe definitions
├── component.go          # Component health tracking
├── monitor.go            # Watchdog loop
├── checks.go             # Health check implementations
└── README.md             # Documentation

client-apps/cli/internal/cli/daemon/
├── health_integration.go # Daemon integration
└── startup_config.go     # Config persistence
```

## Files Modified

```
client-apps/cli/internal/cli/daemon/daemon.go
- Added startHealthMonitoring() call in StartWithOptions()
- Added stopHealthMonitoring() call in Stop()
- Added helper functions GetWorkflowRunnerPID(), GetAgentRunnerContainerID()
- Consolidated log files (stdout+stderr → .log)
- Save startup config for restarts

client-apps/cli/cmd/stigmer/root/server.go
- Enhanced handleServerStatus() with health info
- Added showComponentStatus() helper
- Added showAgentRunnerStatus() helper
- Added health state formatters (getStateDisplay, getHealthSymbol)
- Added duration formatter (formatDuration)
```

## Design Philosophy

**Industry-Proven Patterns:**

1. **Kubernetes** - Three probe types with clear responsibilities
   - Startup: Give slow components time to initialize
   - Liveness: Detect and recover from crashes
   - Readiness: Control when component receives work

2. **Systemd** - Restart policies and backoff limits
   - Always restart on failure (default)
   - Exponential backoff prevents storms
   - Maximum restart limits prevent infinite loops

3. **PM2** - Minimum uptime requirements
   - Component must stabilize before counter resets
   - Distinguishes startup issues from runtime issues

4. **Docker** - Health checks with retry thresholds
   - Multiple consecutive failures before action
   - Prevents false positives from transient failures

## Benefits

**Reliability:**
- ✅ Components automatically recover from crashes
- ✅ No more silent failures
- ✅ Reduced downtime

**Observability:**
- ✅ Clear health status in `stigmer server status`
- ✅ Restart counts and timing visible
- ✅ Last error shown for unhealthy components

**Operations:**
- ✅ No manual intervention needed for transient failures
- ✅ Permanent failures clearly identified (StateFailed)
- ✅ All restarts logged with context

**Developer Experience:**
- ✅ "It just works" - components recover automatically
- ✅ Easy to debug with consolidated logs
- ✅ Status command shows complete picture

## Future Enhancements

Potential improvements (not in scope for this PR):

1. **Metrics & Alerting**
   - Prometheus metrics for health status
   - Alert on repeated failures
   - Track MTBF (Mean Time Between Failures)

2. **HTTP Health Endpoints**
   - Expose health status via HTTP
   - Enable external monitoring (Kubernetes liveness probes, load balancers)

3. **Configurable Health Checks**
   - Allow users to customize probe intervals/timeouts
   - Add custom health check scripts

4. **Circuit Breaker**
   - Temporarily disable failing components
   - Prevent cascading failures

5. **Health Check Plugins**
   - Pluggable health check interface
   - Community-contributed checks

## Success Criteria

All original success criteria met:

- ✅ Watchdog loop monitors all components every 10 seconds
- ✅ Crashed components automatically restart with exponential backoff
- ✅ Status command shows health, uptime, and restart counts
- ✅ No silent failures - all crashes logged and recovered
- ✅ Clean logging - single .log file per component
- ✅ Restart limits prevent infinite loops (max 10 in 10 minutes)

## Impact

### Before
```
Component crashes → Silent failure → User sees "timeout" errors → Manual restart needed
```

### After
```
Component crashes → Detected in <10s → Auto-restart → User never notices
                                      ↓
                            Logs show: "Restarted workflow-runner (attempt 2/10)"
```

## Documentation

- Comprehensive README in `health/` package
- Inline code comments explain design decisions
- Examples of component-specific health checks
- Testing instructions included

## Related Work

- **PR #1**: Added 2-second health check after workflow-runner startup (partial fix)
- **PR #2**: Smart log stream defaults (workflow-runner stdout, stigmer-server stderr)
- **This PR**: Completes production-readiness with continuous monitoring and recovery

## Lessons Learned

1. **Config Persistence is Critical**
   - Can't restart components without their original configuration
   - Startup config must be saved immediately after launch

2. **Minimum Uptime Matters**
   - Without it, crash loops look like successful restarts
   - 10 seconds is good balance for detection

3. **Exponential Backoff Prevents Storms**
   - Linear backoff (1s, 2s, 3s...) too slow
   - No backoff (immediate retry) causes resource exhaustion
   - Exponential (1s, 2s, 4s, 8s...) with cap is optimal

4. **Single Log File is Clearer**
   - Users don't understand Unix stderr convention
   - Combined log file eliminates confusion
   - Timestamps make it easy to interleave stdout/stderr

5. **Restart Limits are Essential**
   - Infinite restarts mask persistent problems
   - Failure state forces investigation
   - 10 restarts in 10 minutes is good threshold

## References

- [Kubernetes Health Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Systemd Restart Policies](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [PM2 Restart Strategies](https://pm2.keymetrics.io/docs/usage/restart-strategies/)
- [Docker Health Checks](https://docs.docker.com/engine/reference/builder/#healthcheck)

---

**Note:** This is a foundational feature for production deployments. Health monitoring and auto-restart are table stakes for any production-grade daemon/service.
