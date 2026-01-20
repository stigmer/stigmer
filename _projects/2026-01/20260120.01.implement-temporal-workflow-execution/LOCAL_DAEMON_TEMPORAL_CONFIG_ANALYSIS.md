# Local Daemon Temporal Configuration Analysis

**Date:** January 20, 2026  
**Context:** Pre-manual testing review of local daemon vs cloud configuration

## Executive Summary

**Status:** ✅ **CONFIGURATION WORKS BY DESIGN** with one potential improvement needed

The local daemon (stigmer-server) Temporal configuration uses **hardcoded sensible defaults** that match the runner configurations. This is CORRECT design for local mode.

However, there's a **potential bug**: The daemon doesn't explicitly pass `TEMPORAL_HOST_PORT` to stigmer-server when starting it.

## Cloud vs Local Configuration Comparison

### Cloud Architecture (Java - stigmer-cloud)

**Configuration Method:** Environment variables injected by Kubernetes/deployment system

```yaml
# Example cloud deployment
env:
  - name: TEMPORAL_SERVICE_ADDRESS
    value: "temporal-frontend.temporal:7233"
  - name: TEMPORAL_NAMESPACE
    value: "production"
  - name: TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE
    value: "workflow_execution_stigmer"
  - name: TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE
    value: "workflow_execution_runner"
  # ... more env vars for agent execution, validation, etc.
```

**Characteristics:**
- ✅ Explicitly configured via environment variables
- ✅ Task queue names injectable per deployment
- ✅ Namespace configurable per environment (dev/staging/prod)
- ✅ Temporal address points to external service

### Local Architecture (Go - stigmer OSS)

**Configuration Method:** Hardcoded defaults + optional environment variable overrides

```go
// stigmer-server/pkg/config/config.go
TemporalHostPort:  getEnvString("TEMPORAL_HOST_PORT", "localhost:7233"),
TemporalNamespace: getEnvString("TEMPORAL_NAMESPACE", "default"),

// Task queue configs (all three domains use this pattern)
StigmerQueue: getEnv("TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE", "workflow_execution_stigmer"),
RunnerQueue:  getEnv("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "workflow_execution_runner"),
```

**Characteristics:**
- ✅ Zero-config by default (sensible hardcoded defaults)
- ✅ Environment variable overrides available for advanced users
- ✅ Temporal managed by daemon (auto-download, auto-start)
- ⚠️  Daemon doesn't explicitly pass Temporal address to stigmer-server

## Configuration Flow Analysis

### 1. Daemon Startup (`daemon.go`)

```go
// Load CLI configuration
cfg, err := config.Load() // Loads ~/.stigmer/config.yaml

// Resolve Temporal configuration
temporalAddr, isManaged := cfg.Backend.Local.ResolveTemporalAddress()
// Returns: "localhost:7233" (managed) or custom address (external)

// Start managed Temporal if configured
if isManaged {
    temporalManager.Start()
    temporalAddr = temporalManager.GetAddress()
}
```

**Result:** Daemon knows the correct Temporal address

### 2. Starting stigmer-server (`daemon.go` lines 162-166)

```go
cmd := exec.Command(serverBin)
cmd.Env = append(os.Environ(),
    fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
    fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
)
```

**Problem:** Daemon does NOT explicitly pass:
- ❌ `TEMPORAL_HOST_PORT` (or `TEMPORAL_SERVICE_ADDRESS`)
- ❌ `TEMPORAL_NAMESPACE`

**Why it works:** `os.Environ()` copies parent process environment, so stigmer-server inherits any Temporal env vars the user set. If none set, stigmer-server falls back to hardcoded defaults which happen to match.

**Why it's fragile:**
1. If daemon resolves custom Temporal address from config, stigmer-server won't know
2. If daemon starts managed Temporal on non-standard port, stigmer-server won't know
3. Relies on implicit inheritance instead of explicit communication

### 3. Starting workflow-runner (`daemon.go` lines 253-272)

```go
env := os.Environ()
env = append(env,
    "EXECUTION_MODE=temporal",
    fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr), // ✅ Explicitly passed
    "TEMPORAL_NAMESPACE=default",
    "WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
    "ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
    "WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
    // ...
)
```

**Correct:** Daemon explicitly passes Temporal configuration to workflow-runner

### 4. Starting agent-runner (`daemon.go` lines 341-368)

```go
env = append(env,
    "MODE=local",
    fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr), // ✅ Explicitly passed
    "TEMPORAL_NAMESPACE=default",
    "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner",
    // ...
)
```

**Correct:** Daemon explicitly passes Temporal configuration to agent-runner

### 5. stigmer-server initialization (`main.go` lines 78-96)

```go
// Create Temporal client
temporalClient, err := client.Dial(client.Options{
    HostPort:  cfg.TemporalHostPort,  // From env or default "localhost:7233"
    Namespace: cfg.TemporalNamespace, // From env or default "default"
})
```

**Issue:** If daemon started Temporal on custom port or resolved custom address from config, stigmer-server won't know unless the parent shell had those env vars set.

## Task Queue Configuration

### All Three Worker Domains Use Same Pattern

**1. Workflow Execution** (`workflowexecution/temporal/config.go`):
```go
StigmerQueue: getEnv("TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE", "workflow_execution_stigmer"),
RunnerQueue:  getEnv("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "workflow_execution_runner"),
```

**2. Agent Execution** (`agentexecution/temporal/config.go`):
```go
StigmerQueue: getEnv("TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE", "agent_execution_stigmer"),
RunnerQueue:  getEnv("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE", "agent_execution_runner"),
```

**3. Workflow Validation** (`workflow/temporal/config.go`):
```go
StigmerQueue: getEnv("TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE", "workflow_validation_stigmer"),
RunnerQueue:  getEnv("TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE", "workflow_validation_runner"),
```

**Design:** Hardcoded defaults match what daemon passes to runners. Works by convention.

## Environment Variable Matrix

| Variable | Cloud (Required) | Local (Optional) | Default | Passed by Daemon |
|----------|-----------------|------------------|---------|------------------|
| **Temporal Connection** |
| `TEMPORAL_HOST_PORT` or `TEMPORAL_SERVICE_ADDRESS` | ✅ | 🔶 | `localhost:7233` | ❌ stigmer-server<br>✅ runners |
| `TEMPORAL_NAMESPACE` | ✅ | 🔶 | `default` | ❌ stigmer-server<br>✅ runners |
| **Workflow Execution Task Queues** |
| `TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE` | ✅ | 🔶 | `workflow_execution_stigmer` | ❌ |
| `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE` | ✅ | 🔶 | `workflow_execution_runner` | ✅ |
| **Agent Execution Task Queues** |
| `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE` | ✅ | 🔶 | `agent_execution_stigmer` | ❌ |
| `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE` | ✅ | 🔶 | `agent_execution_runner` | ✅ |
| **Workflow Validation Task Queues** |
| `TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE` | ✅ | 🔶 | `workflow_validation_stigmer` | ❌ |
| `TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE` | ✅ | 🔶 | `workflow_validation_runner` | ✅ |

**Legend:**
- ✅ Required/Passed
- ❌ Not passed
- 🔶 Optional (has sensible default)

## Why Local Mode Works Despite Missing Explicit Config

1. **Hardcoded Defaults Match:**
   - stigmer-server defaults to `localhost:7233` (same as managed Temporal)
   - Task queue names match between stigmer-server and runners

2. **Convention Over Configuration:**
   - All components use same naming convention
   - Reduces configuration burden for local development

3. **Environment Inheritance:**
   - stigmer-server inherits parent shell's environment via `os.Environ()`
   - If user sets custom env vars, stigmer-server picks them up

## The Bug: Daemon Doesn't Pass Temporal Address

### Scenario Where It Fails

**User configuration** (`~/.stigmer/config.yaml`):
```yaml
backend:
  type: local
  local:
    temporal:
      managed: true
      port: 7234  # Custom port
```

**What happens:**
1. Daemon resolves `temporalAddr = "localhost:7234"` from config
2. Daemon starts Temporal on port 7234 ✅
3. Daemon starts workflow-runner with `TEMPORAL_SERVICE_ADDRESS=localhost:7234` ✅
4. Daemon starts agent-runner with `TEMPORAL_SERVICE_ADDRESS=localhost:7234` ✅
5. Daemon starts stigmer-server with NO Temporal env vars ❌
6. stigmer-server defaults to `localhost:7233` ❌ **WRONG PORT**
7. stigmer-server fails to connect to Temporal ❌

### Current Workaround

It works today because:
- Config says port is not configurable (hardcoded to 7233)
- Managed Temporal always starts on 7233
- No users customize Temporal port

But the code ALLOWS customization, creating a latent bug.

## Recommended Fix

### Option 1: Explicit Configuration Pass (Recommended)

**Change:** Update `daemon.go` to explicitly pass Temporal config to stigmer-server

```go
// daemon.go lines 162-166 (current)
cmd := exec.Command(serverBin)
cmd.Env = append(os.Environ(),
    fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
    fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
)

// RECOMMENDED: Add explicit Temporal configuration
cmd := exec.Command(serverBin)
cmd.Env = append(os.Environ(),
    fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
    fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
    
    // Temporal configuration (explicitly resolved by daemon)
    fmt.Sprintf("TEMPORAL_HOST_PORT=%s", temporalAddr),
    "TEMPORAL_NAMESPACE=default",
    
    // Optional: Task queue names (if we want to support customization)
    // "TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE=workflow_execution_stigmer",
    // "TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer",
    // "TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE=workflow_validation_stigmer",
)
```

**Benefits:**
- ✅ Explicit communication (no implicit inheritance)
- ✅ Handles custom Temporal ports correctly
- ✅ Works even if user's shell has different env vars
- ✅ Consistent with how runners are configured

### Option 2: Remove Port Configurability

**Change:** Truly hardcode Temporal port to 7233, remove from config

```go
// config/config.go - Remove port from TemporalConfig
type TemporalConfig struct {
    Managed bool   `yaml:"managed"`
    Address string `yaml:"address,omitempty"` // Only for external Temporal
    // REMOVE: Port int (always 7233 for managed)
}

// Always use standard port
func (c *LocalBackendConfig) ResolveTemporalPort() int {
    return 7233 // Not configurable
}
```

**Benefits:**
- ✅ Simplifies configuration
- ✅ Eliminates this class of bugs
- ✅ Matches the comment "not configurable for managed mode"

**Tradeoffs:**
- ❌ Less flexible (but flexibility may not be needed)

## Testing Recommendations

Before declaring the implementation complete, test these scenarios:

### Test 1: Default Configuration
```bash
# Start with no custom config
rm -f ~/.stigmer/config.yaml
stigmer server
```

**Expected:** All workers connect to `localhost:7233`

### Test 2: Custom External Temporal
```bash
# Start external Temporal on port 7234
temporal server start-dev --port 7234

# Configure stigmer to use it
cat > ~/.stigmer/config.yaml <<EOF
backend:
  type: local
  local:
    temporal:
      managed: false
      address: localhost:7234
EOF

stigmer server
```

**Expected:** ❌ **WILL FAIL** - stigmer-server connects to 7233, runners to 7234

### Test 3: Environment Variable Override
```bash
# Set env var BEFORE starting daemon
export TEMPORAL_HOST_PORT=localhost:7234
stigmer server
```

**Expected:** ✅ **Should work** - stigmer-server inherits env var

## Conclusion

**For Manual Testing:**
1. ✅ Default configuration will work (managed Temporal on 7233)
2. ✅ Task queue names are correctly hardcoded with sensible defaults
3. ⚠️  Custom Temporal addresses may not work (daemon doesn't pass to stigmer-server)

**Recommendation:**
- Proceed with manual testing (default case will work)
- File issue for daemon not passing Temporal config explicitly
- Implement Option 1 (explicit config pass) before any production release

---

**Next Steps:**
1. Manual testing with default config (Task 5)
2. Create GitHub issue for Temporal config passing bug
3. Implement fix (Option 1) in separate PR
