# Notes & Learnings

## Research Notes

### Industry Patterns Analysis (2026-01-22)

Researched how production systems handle process supervision:

**Systemd (Linux standard):**
- Restart policies: `always`, `on-failure`, `no`
- Backoff: `RestartSec` with `StartLimitBurst` and `StartLimitInterval`
- Watchdog: Process must ping systemd periodically
- Key insight: Separate stdout/stderr → journal (unified logging)

**Kubernetes (cloud native):**
- 3 probe types:
  - Startup: Initial health during boot
  - Liveness: Should container restart?
  - Readiness: Should receive traffic?
- HTTP/TCP/Exec probe methods
- Configurable thresholds and timeouts
- Key insight: Different probes for different concerns

**PM2 (Node.js, 50M+ downloads/month):**
- `min_uptime`: Must stay up 10s to count as success
- `max_restarts`: Give up after N failures
- `exp_backoff_restart_delay`: Exponential backoff built-in
- Key insight: Minimum uptime prevents restart loops

**Docker/Docker Compose:**
- Health checks: Shell commands that return 0/1
- `start_period`: Grace time during startup
- `interval`, `timeout`, `retries` configurable
- Key insight: Simple, command-based health checks

### Logging Convention Confusion

**Unix Convention (counterintuitive!):**
- `stderr` = Diagnostic output (logs, progress, status)
- `stdout` = Data/results (parseable output)

This is WHY `.err` files have all logs! But it's confusing to users.

**Our Components:**
- stigmer-server: Uses zerolog → stderr (Unix convention)
- workflow-runner: Uses Go log package → stdout (Go default)
- agent-runner: Docker → both streams

**Solution:** Merge stdout+stderr → single .log file. Simpler for users.

---

## Design Decisions

### Why Kubernetes Model Over Systemd?

**Kubernetes-inspired approach chosen because:**
- ✅ More flexible (3 probe types vs watchdog protocol)
- ✅ Industry standard (familiar to developers)
- ✅ No IPC needed (HTTP/TCP checks, not watchdog pings)
- ✅ Easier to test (just check functions)
- ✅ Better for containerized future

**Systemd watchdog would require:**
- ❌ IPC between processes (SD_NOTIFY)
- ❌ Components must implement watchdog protocol
- ❌ Less familiar to developers

---

## Implementation Notes

### Partial Fixes Already Applied

**Fix #1: Startup Health Check (daemon.go:520-548)**
```go
// Wait 2 seconds then check if process still running
time.Sleep(2 * time.Second)
if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
    // Process crashed, read logs and report
}
```

Catches immediate crashes but not later failures.

**Fix #2: Smart Log Defaults**
- stigmer-server → stderr (.err file)
- workflow-runner → stdout (.log file)
- agent-runner → Docker (both streams)

Works but confusing. Task 5 will consolidate to .log only.

---

## Questions & Decisions Needed

### Open Questions

1. **Restart backoff timing:**
   - Current plan: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
   - Configurable? Or hardcoded?

2. **Max restarts:**
   - Current plan: 10 restarts in 10 minutes
   - Should this be per-component configurable?

3. **Health check intervals:**
   - Current plan: Every 10 seconds
   - Too aggressive? Too slow?

4. **Alert on max restarts:**
   - Log warning?
   - Desktop notification?
   - Stop trying?

5. **Health endpoints:**
   - Should we add HTTP health endpoints?
   - Or keep it simple with PID checks?

### Decisions Made

- ✅ Use Kubernetes probe model (not systemd watchdog)
- ✅ Consolidate to .log files (remove .err confusion)
- ✅ Watchdog in daemon goroutine (not separate process)
- ✅ PID-based checks initially (HTTP endpoints later)

---

## Code Patterns to Follow

### Health Check Interface Template
```go
type HealthProbe interface {
    Check(ctx context.Context) error
    Type() ProbeType
    Interval() time.Duration
    Timeout() time.Duration
    FailureThreshold() int
}
```

### Component Interface Template
```go
type Component interface {
    Name() string
    IsHealthy(ctx context.Context) (bool, error)
    Restart(ctx context.Context) error
    GetState() ComponentState
    GetHealth() HealthInfo
}
```

### Watchdog Loop Pattern
```go
func watchdogLoop(components []Component) {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ticker.C:
            for _, comp := range components {
                go checkAndRestart(comp) // Non-blocking
            }
        }
    }
}
```

---

## Testing Strategy

### Manual Test Scenarios

1. **Kill stigmer-server**: `kill -9 <pid>` → Should auto-restart
2. **Kill workflow-runner**: `kill -9 <pid>` → Should auto-restart
3. **Stop Docker**: `docker stop stigmer-agent-runner` → Should auto-restart container
4. **Rapid crash loop**: Crash 11 times → Should give up after 10
5. **Status during restart**: Check status while restarting → Should show transitioning state

### Verification Commands

```bash
# Monitor health
watch -n 1 'stigmer server status'

# Simulate crashes
kill -9 $(cat ~/.stigmer/data/workflow-runner.pid)

# Check logs
stigmer server logs --all --follow

# Verify restart counts
stigmer server status | grep -i restart
```

---

## Links & References

- Kubernetes probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Systemd service: https://www.freedesktop.org/software/systemd/man/systemd.service.html
- PM2 restart strategies: https://pm2.keymetrics.io/docs/usage/restart-strategies/
- 12-factor app logging: https://12factor.net/logs

---

## Future Enhancements (Out of Scope)

- HTTP health endpoints (grpc.health.v1.Health)
- Metrics export (Prometheus)
- Distributed tracing integration
- Custom health check plugins
- Desktop notifications on failures
- Email/Slack alerts on max restarts
- Health check dashboard

Keep it simple for now. These can be added later.
