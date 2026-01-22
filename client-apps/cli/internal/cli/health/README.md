# Health Monitoring Package

Production-grade health monitoring and auto-restart for stigmer daemon components.

## Overview

This package provides Kubernetes-inspired health checking with automatic restart capabilities. It monitors process health, detects failures, and automatically recovers crashed components.

## Design Principles

**Inspired by industry-proven patterns:**
- **Kubernetes**: Three probe types (startup, liveness, readiness)
- **Systemd**: Restart policies with backoff limits
- **PM2**: Minimum uptime requirements
- **Docker**: Health checks with retry thresholds

## Core Concepts

### Probe Types

**Startup Probe**
- Checks if component has started successfully
- Gives slow-starting components time to initialize
- Runs frequently with high failure tolerance (30 failures = 30 seconds)
- Delays liveness checks until startup succeeds

**Liveness Probe**
- Checks if component is alive and healthy
- Detects crashes and unresponsive components
- Triggers restart after failure threshold (default: 3 consecutive failures)
- Runs every 10 seconds

**Readiness Probe**
- Checks if component is ready to handle work
- Determines if component should receive traffic/tasks
- Does NOT trigger restart - just marks as not ready
- Runs every 5 seconds

### Component States

```
StateStarting   → Component is starting up
StateRunning    → Component is healthy
StateUnhealthy  → Component failed health checks
StateRestarting → Component is being restarted
StateStopped    → Component is stopped
StateFailed     → Component exceeded restart limits
```

### Restart Policy

```
RestartPolicyAlways       → Always restart on failure (default)
RestartPolicyOnFailure    → Only restart on error exit
RestartPolicyNever        → Never restart
```

## Usage

### Basic Setup

```go
import "github.com/stigmer/stigmer/client-apps/cli/internal/cli/health"

// Create monitor
monitor := health.NewMonitor()

// Create component
component := health.NewComponent("stigmer-server", health.ComponentTypeStigmerServer)

// Configure liveness probe
component.LivenessProbe = &health.HealthProbe{
    Type:     health.ProbeTypeLiveness,
    Check:    func(ctx context.Context) error {
        // Return nil if healthy, error if unhealthy
        return checkServerHealth(ctx)
    },
    Interval:         10 * time.Second,
    Timeout:          3 * time.Second,
    FailureThreshold: 3,
    SuccessThreshold: 1,
}

// Configure restart function
component.RestartFunc = func(ctx context.Context) error {
    return restartServer(ctx)
}

// Register and start monitoring
monitor.RegisterComponent(component)
component.Start()
monitor.Start(context.Background())
```

### Component-Specific Health Checks

**stigmer-server**
```go
func checkStigmerServerHealth(ctx context.Context) error {
    // 1. Check process is alive (PID exists)
    if !isProcessAlive(pid) {
        return fmt.Errorf("process not running")
    }
    
    // 2. Check gRPC port is responding
    conn, err := grpc.DialContext(ctx, "localhost:50051", ...)
    if err != nil {
        return fmt.Errorf("grpc port not responding: %w", err)
    }
    defer conn.Close()
    
    // 3. Optional: Call gRPC health endpoint
    // healthClient := grpc_health_v1.NewHealthClient(conn)
    // resp, err := healthClient.Check(ctx, &grpc_health_v1.HealthCheckRequest{})
    
    return nil
}
```

**workflow-runner**
```go
func checkWorkflowRunnerHealth(ctx context.Context) error {
    // 1. Check process is alive
    if !isProcessAlive(pid) {
        return fmt.Errorf("process not running")
    }
    
    // 2. Check minimum uptime (not crash looping)
    uptime := time.Since(startTime)
    if uptime < 10*time.Second {
        return fmt.Errorf("recently restarted: %s", uptime)
    }
    
    // 3. Check Temporal worker is polling (via logs or API)
    if !isPollingTemporalTasks() {
        return fmt.Errorf("not polling Temporal tasks")
    }
    
    return nil
}
```

**agent-runner (Docker)**
```go
func checkAgentRunnerHealth(ctx context.Context) error {
    // 1. Check container is running
    cmd := exec.CommandContext(ctx, "docker", "ps", "--filter", "name=stigmer-agent-runner", "--format", "{{.Status}}")
    output, err := cmd.Output()
    if err != nil || len(output) == 0 {
        return fmt.Errorf("container not running")
    }
    
    // 2. Check container health status
    cmd = exec.CommandContext(ctx, "docker", "inspect", "--format", "{{.State.Health.Status}}", "stigmer-agent-runner")
    output, err = cmd.Output()
    if err == nil && strings.TrimSpace(string(output)) == "unhealthy" {
        return fmt.Errorf("container unhealthy")
    }
    
    return nil
}
```

### Restart Configuration

```go
// Default configuration (sensible defaults)
component.RestartConfig = health.DefaultRestartConfig()

// Custom configuration
component.RestartConfig = health.RestartConfig{
    Policy:            health.RestartPolicyAlways,
    MaxRestarts:       10,                    // Max 10 restarts
    RestartWindow:     10 * time.Minute,      // Within 10 minutes
    MinUptime:         10 * time.Second,      // Must run 10s to be considered stable
    InitialBackoff:    1 * time.Second,       // Start with 1s backoff
    MaxBackoff:        60 * time.Second,      // Cap at 60s backoff
    BackoffMultiplier: 2.0,                   // Double each time (1s, 2s, 4s, 8s, 16s, 32s, 60s)
}
```

### Exponential Backoff

Restarts use exponential backoff to prevent restart storms:

```
Restart 1: 1s delay
Restart 2: 2s delay
Restart 3: 4s delay
Restart 4: 8s delay
Restart 5: 16s delay
Restart 6: 32s delay
Restart 7+: 60s delay (capped at MaxBackoff)
```

### Getting Component Status

```go
// Get health status
health := component.GetHealth()
fmt.Printf("State: %s\n", health.State)
fmt.Printf("Uptime: %s\n", component.GetUptime())
fmt.Printf("Restarts: %d\n", health.RestartCount)
fmt.Printf("Last Error: %v\n", health.LastError)

// Check if healthy
if component.IsHealthy() {
    fmt.Println("Component is healthy")
}

// Get summary for all components
summary := monitor.GetHealthSummary()
for name, health := range summary {
    fmt.Printf("%s: %s\n", name, health.State)
}
```

## Restart Limits

Components enter **StateFailed** after exceeding restart limits:

```
MaxRestarts:   10
RestartWindow: 10 minutes

If component restarts 10 times within 10 minutes → StateFailed
Manual intervention required to recover
```

**Why restart limits?**
- Prevent infinite restart loops
- Detect persistent failures (not transient issues)
- Alert operator to investigate root cause
- Preserve system resources

## Minimum Uptime

Components must run for `MinUptime` (default: 10 seconds) before restart is considered successful:

```
Component starts → Crashes after 5s → Restart failed (counter increments)
Component starts → Runs 15s → Crash → Restart successful (counter resets)
```

**Why minimum uptime?**
- Distinguish startup failures from runtime failures
- Detect crash loops vs. transient issues
- Prevent rapid restart cycling

## Thread Safety

All operations are thread-safe:
- Multiple goroutines can check health simultaneously
- Concurrent restarts are prevented
- Health state updates are synchronized

## Testing

```go
// Create test component
component := health.NewComponent("test", health.ComponentTypeStigmerServer)

// Mock health check
component.LivenessProbe = &health.HealthProbe{
    Type: health.ProbeTypeLiveness,
    Check: func(ctx context.Context) error {
        // Simulate failure
        return fmt.Errorf("simulated failure")
    },
    Interval:         1 * time.Second,
    Timeout:          1 * time.Second,
    FailureThreshold: 3,
    SuccessThreshold: 1,
}

// Mock restart
restartCount := 0
component.RestartFunc = func(ctx context.Context) error {
    restartCount++
    return nil
}

// Run checks until restart triggered
for i := 0; i < 5; i++ {
    component.RunHealthCheck(context.Background())
    time.Sleep(1 * time.Second)
}

// Verify restart was called
if restartCount == 0 {
    t.Error("Expected restart to be called")
}
```

## Integration with Daemon

```go
// In daemon.go
var healthMonitor *health.Monitor

func StartWithOptions(dataDir string, opts StartOptions) error {
    // ... existing startup code ...
    
    // Initialize health monitor
    healthMonitor = health.NewMonitor()
    
    // Register stigmer-server
    serverComponent := createStigmerServerComponent(dataDir)
    healthMonitor.RegisterComponent(serverComponent)
    serverComponent.Start()
    
    // Register workflow-runner
    workflowComponent := createWorkflowRunnerComponent(dataDir)
    healthMonitor.RegisterComponent(workflowComponent)
    workflowComponent.Start()
    
    // Register agent-runner
    agentComponent := createAgentRunnerComponent(dataDir)
    healthMonitor.RegisterComponent(agentComponent)
    agentComponent.Start()
    
    // Start monitoring
    healthMonitor.Start(context.Background())
    
    return nil
}

func Stop(dataDir string) error {
    // Stop health monitoring first
    if healthMonitor != nil {
        healthMonitor.Stop()
    }
    
    // ... existing stop code ...
}
```

## Best Practices

1. **Always set FailureThreshold > 1** to avoid restarting on transient failures
2. **Set appropriate timeouts** - health checks should complete quickly (< 3 seconds)
3. **Use exponential backoff** to prevent restart storms
4. **Set restart limits** to detect persistent failures
5. **Log all health check failures** for debugging
6. **Test restart logic** with intentional failures
7. **Monitor restart counts** in production

## Troubleshooting

**Component stuck in StateStarting**
- Startup probe is failing
- Increase FailureThreshold or Timeout
- Check startup probe logic

**Component immediately enters StateFailed**
- Restart limits too low
- Increase MaxRestarts or RestartWindow
- Fix underlying issue causing rapid crashes

**Health checks timing out**
- Timeout too short
- Health check doing too much work
- Optimize health check or increase Timeout

**Restart loops**
- Component crashes before MinUptime
- Fix underlying crash cause
- Increase MinUptime if component takes time to stabilize

## See Also

- [Kubernetes Health Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Systemd Restart Policies](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [PM2 Restart Strategies](https://pm2.keymetrics.io/docs/usage/restart-strategies/)
