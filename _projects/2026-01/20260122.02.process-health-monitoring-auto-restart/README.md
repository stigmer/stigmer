# Project: Process Health Monitoring & Auto-Restart

**Created**: 2026-01-22  
**Status**: ⏸️ TODO  
**Estimated Time**: 3-4 hours (1-2 sessions)

## Description

Add Kubernetes-style health monitoring and auto-restart to stigmer daemon for production-ready process supervision. Eliminates silent failures and ensures stigmer-server, workflow-runner, and agent-runner automatically recover from crashes.

## Primary Goal

Implement production-grade health monitoring with automatic restart for all stigmer daemon components, following proven patterns from systemd, Kubernetes, and PM2. No more silent failures or manual restarts.

## Context

**Current Problem:**
- Process crashes go undetected (silent failures)
- No automatic recovery from crashes
- Users experience "workflow timeout" errors
- Manual intervention required to restart components

**Root Cause:**
- Only checks if `cmd.Start()` succeeds
- No continuous health monitoring
- Post-startup crashes are invisible
- No restart policies

**Industry Standards We're Following:**
- **Kubernetes**: 3 probe types (startup, liveness, readiness)
- **Systemd**: Restart policies with backoff limits
- **PM2**: Minimum uptime requirements
- **Docker**: Health checks with retry thresholds

## Technical Details

**Technology Stack**: Go/CLI/Daemon

**Project Type**: Infrastructure Enhancement

**Affected Components**:
- `client-apps/cli/internal/cli/daemon/` - Add watchdog loop
- `client-apps/cli/internal/cli/health/` - New health check package (to be created)
- `client-apps/cli/cmd/stigmer/root/server.go` - Enhanced status command
- Logging configuration - Merge stdout+stderr → single .log file

## Architecture

### Health Check Interface (Kubernetes-inspired)
```go
type HealthProbe struct {
    Type     ProbeType  // Startup, Liveness, Readiness
    Check    func() error
    Interval time.Duration
    Timeout  time.Duration
    Failures int  // Threshold before action
}

type Component struct {
    Name           string
    Process        *exec.Cmd
    
    // Health probes
    StartupProbe   *HealthProbe
    LivenessProbe  *HealthProbe
    ReadinessProbe *HealthProbe
    
    // Restart policy
    RestartPolicy  RestartPolicy
    MaxRestarts    int
    MinUptime      time.Duration
    
    // State
    State          ComponentState
    RestartCount   int
    LastRestart    time.Time
}
```

### Component-Specific Health Checks

**stigmer-server:**
- PID check (process alive)
- gRPC health endpoint (port responding)
- Temporal connection (can talk to Temporal)

**workflow-runner:**
- PID check
- Temporal worker polling (actively polling task queues)
- Log file growth (not stuck)

**agent-runner (Docker):**
- Container running (`docker ps`)
- Container health status
- Log inspection (no crash loops)

### Restart Logic
```
Crash detected → Wait (exponential backoff) → Restart → Check uptime
                                                          ↓
                                            < MinUptime → Restart failed (count++)
                                            ≥ MinUptime → Reset counter
                                                          ↓
                                            Count > Max → Give up, alert
```

## Success Criteria

1. ✅ Watchdog loop monitors all components every 10 seconds
2. ✅ Crashed components automatically restart with exponential backoff
3. ✅ Status command shows health, uptime, and restart counts
4. ✅ No silent failures - all crashes logged and recovered
5. ✅ Clean logging - single .log file per component (no .err confusion)
6. ✅ Restart limits prevent infinite loops (max 10 restarts in 10 minutes)

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

## References

- Industry patterns document (see conversation history)
- Kubernetes health probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Systemd restart policies: https://www.freedesktop.org/software/systemd/man/systemd.service.html
- PM2 process management: https://pm2.keymetrics.io/docs/usage/restart-strategies/

## Related Work

- Fix #1: Added 2-second health check after workflow-runner startup (partial fix)
- Fix #2: Smart log stream defaults (workflow-runner stdout, stigmer-server stderr)

This project completes the production-readiness journey by adding continuous monitoring and recovery.
