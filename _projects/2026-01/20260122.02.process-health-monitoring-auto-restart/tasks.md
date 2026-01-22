# Tasks

## Task 1: Design Health Check Interface
**Status**: ⏸️ TODO  
**Estimated**: 30 minutes

Define the health check interface following Kubernetes probe model:
- [ ] Create `health` package structure
- [ ] Define `HealthProbe` interface (startup, liveness, readiness)
- [ ] Define `Component` interface
- [ ] Define `RestartPolicy` types
- [ ] Design state management (ComponentState enum)
- [ ] Document probe types and when to use each

**Acceptance Criteria:**
- Clear interface that works for all component types (process, Docker)
- Probe types map to Kubernetes concepts
- Extensible for future component types

---

## Task 2: Implement Health Monitoring
**Status**: ⏸️ TODO  
**Estimated**: 90 minutes

Implement health checks for each component type:

### 2.1 stigmer-server Health Checks
- [ ] PID-based liveness check
- [ ] gRPC port connectivity check
- [ ] Optional: gRPC health endpoint (grpc.health.v1.Health)

### 2.2 workflow-runner Health Checks
- [ ] PID-based liveness check
- [ ] Check Temporal worker is polling (via log patterns or API)
- [ ] Minimum uptime validation (10s)

### 2.3 agent-runner (Docker) Health Checks
- [ ] Container running check (`docker ps`)
- [ ] Container health status check
- [ ] Log inspection for crash patterns

**Acceptance Criteria:**
- Each component has working liveness probe
- Probes complete in < 1 second
- False positives handled (startup grace period)
- All checks return clear errors on failure

---

## Task 3: Add Watchdog Loop with Restart Logic
**Status**: ⏸️ TODO  
**Estimated**: 60 minutes

Implement the continuous monitoring and auto-restart system:
- [ ] Create watchdog goroutine in daemon
- [ ] Run health checks every 10 seconds
- [ ] Detect crashed components
- [ ] Implement exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 60s max)
- [ ] Track restart counts and timing
- [ ] Implement restart limits (max 10 in 10 minutes)
- [ ] Log all restart attempts with context
- [ ] Graceful shutdown (SIGTERM → wait → SIGKILL)

**Restart Flow:**
```
Check health → Unhealthy → Calculate backoff → Wait → Restart
                                                        ↓
                                                Check uptime → Update counters
```

**Acceptance Criteria:**
- Watchdog runs continuously without blocking
- Crashed components restart within 10 seconds + backoff
- Logs clearly show restart attempts and reasons
- Restart limits prevent infinite loops
- Graceful shutdown on daemon stop

---

## Task 4: Enhance Status Command
**Status**: ⏸️ TODO  
**Estimated**: 30 minutes

Improve `stigmer server status` to show health information:
- [ ] Show health status for each component (✓ Healthy / ✗ Unhealthy)
- [ ] Display PID and uptime
- [ ] Show restart count
- [ ] Display last restart time (if any)
- [ ] Color-code health indicators (green/yellow/red)
- [ ] Add `--verbose` flag for probe details

**Example Output:**
```
Stigmer Server Status:
─────────────────────────────────────
Stigmer Server:
  Status:   ✓ Running
  Health:   ✓ Healthy
  PID:      12345
  Uptime:   2h 15m
  Restarts: 0

Workflow Runner:
  Status:   ✓ Running
  Health:   ✓ Healthy
  PID:      12346
  Uptime:   2h 15m
  Restarts: 0

Agent Runner (Docker):
  Status:   ✓ Running
  Health:   ✓ Healthy
  Container: stigmer-agent-runner
  Uptime:   2h 14m
  Restarts: 0

Temporal:
  Status:   ✓ Running
  Address:  localhost:7233
```

**Acceptance Criteria:**
- Clear, scannable status output
- Easy to spot unhealthy components
- Restart history visible
- Works when components are stopped

---

## Task 5: Fix .log vs .err Confusion
**Status**: ⏸️ TODO  
**Estimated**: 30 minutes

Consolidate logging to eliminate .err file confusion:
- [ ] Update daemon to redirect both stdout+stderr to single .log file
- [ ] Update stigmer-server startup (if needed)
- [ ] Update workflow-runner startup (if needed)
- [ ] Remove .err file handling from logs command
- [ ] Update smart defaults to always use .log files
- [ ] Test logs command shows all output correctly

**Current Problem:**
- `.err` files suggest "errors only" but contain all logs (Unix convention)
- Different components log to different streams (inconsistent)
- Users confused about where to find logs

**Solution:**
- All components → `.log` file (stdout+stderr combined)
- Consistent across all processes
- No more .err confusion

**Acceptance Criteria:**
- All components write to .log files only
- No .err files created (or they remain empty)
- `stigmer server logs --all` shows all component logs
- No smart defaults needed (everything in .log)

---

## Progress Summary

- **Total Tasks**: 5
- **Completed**: 0
- **In Progress**: 0
- **TODO**: 5

**Next Step**: Start with Task 1 (Design Health Check Interface)
