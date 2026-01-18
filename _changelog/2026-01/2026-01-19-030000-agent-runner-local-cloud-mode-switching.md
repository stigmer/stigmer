# Agent Runner: Local/Cloud Mode Switching Implementation

**Date**: January 19, 2026  
**Component**: Agent Runner (OSS)  
**Type**: Feature Enhancement  
**Impact**: Enables agent runner to operate in both local and cloud modes

## Overview

Implemented mode-aware initialization in the Agent Runner to support both local execution (filesystem-based) and cloud execution (Daytona/Redis-based) from a single codebase.

## Changes

### 1. Worker Initialization (`worker/worker.py`)

**Added Mode-Aware Redis Initialization**:
- Redis connection is now **conditional** based on `MODE` environment variable
- Local mode (`MODE=local`): Skips Redis, uses gRPC to Stigmer Daemon
- Cloud mode (`MODE=cloud` or unset): Initializes Redis for pub/sub

**Implementation**:
```python
def __init__(self, config: Config):
    # ... existing init ...
    
    # Initialize Redis in cloud mode only
    if not config.is_local_mode():
        self._initialize_redis()
    else:
        self.logger.info("Local mode: Skipping Redis initialization (using gRPC to Stigmer Daemon)")
```

**Added Shutdown Method**:
- Properly closes Redis connections in cloud mode
- Stops worker and waits for in-flight activities
- Graceful cleanup on shutdown signal

### 2. Enhanced Logging (`worker/worker.py`, `main.py`)

**Startup Banner**:
```
============================================================
🚀 Stigmer Agent Runner - LOCAL Mode
============================================================
Task Queue: agent_execution_runner
Temporal: localhost:7233 (namespace: default)
Backend: localhost:50051
Sandbox: filesystem (root: ./workspace)
Note: Using gRPC to Stigmer Daemon for state/streaming
============================================================
```

**Mode-Specific Configuration Display**:
- Local mode: Shows sandbox type and root directory
- Cloud mode: Shows Daytona sandbox and Redis connection details

### 3. Improved Error Handling (`main.py`)

**Configuration Loading**:
- Try/catch around `Config.load_from_env()` with clear error messages
- Fail fast if configuration is invalid

**Worker Initialization**:
- Try/catch around `AgentRunner()` initialization
- Catches Redis connection failures in cloud mode

**Temporal Connection**:
- Try/catch in `register_activities()` with specific error messages
- Clear indication if Temporal server is unreachable

### 4. Cleanup of Outdated Code (`main.py`)

**Removed**:
- Reference to non-existent `worker.rotation_task`
- Redundant shutdown logic

**Simplified**:
- Shutdown handler now calls `worker.shutdown()` method
- All cleanup logic centralized in worker class

## Architecture

### Local Mode Flow

```
User runs agent → MODE=local detected
         ↓
  Skip Redis init
         ↓
  Connect to Stigmer Daemon gRPC (localhost:50051)
         ↓
  Use filesystem sandbox (./workspace)
         ↓
  API key = "dummy-local-key" (validation relaxed)
```

### Cloud Mode Flow

```
User runs agent → MODE=cloud detected
         ↓
  Initialize Redis connection
         ↓
  Connect to cloud backend gRPC
         ↓
  Use Daytona sandbox
         ↓
  API key = validated JWT from Auth0
```

## Configuration

### Local Mode Environment Variables

```bash
# Required
MODE="local"
TEMPORAL_SERVICE_ADDRESS="localhost:7233"
TEMPORAL_NAMESPACE="default"
TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE="agent_execution_runner"
STIGMER_BACKEND_ENDPOINT="localhost:50051"

# Optional (defaults provided)
SANDBOX_TYPE="filesystem"
SANDBOX_ROOT_DIR="./workspace"
STIGMER_API_KEY="dummy-local-key"  # Auto-set if missing
```

### Cloud Mode Environment Variables

```bash
# Required
MODE="cloud"  # or omit (defaults to cloud)
TEMPORAL_SERVICE_ADDRESS="<temporal-cloud-address>"
REDIS_HOST="<redis-host>"
REDIS_PORT="6379"
STIGMER_BACKEND_ENDPOINT="<backend-endpoint>"
STIGMER_API_KEY="<auth0-jwt>"

# Optional
REDIS_PASSWORD="<password>"
DAYTONA_DEV_TOOLS_SNAPSHOT_ID="<snapshot-id>"
```

## Benefits

1. **Single Codebase**: No need for separate local/cloud worker implementations
2. **Clean Separation**: Mode detection via environment variable, no conditional logic scattered throughout code
3. **Fail-Fast**: Clear error messages if configuration is missing or invalid
4. **Graceful Shutdown**: Proper cleanup of connections in both modes
5. **Developer Experience**: Clear logging shows exactly what mode is active and what's configured

## Testing

### Local Mode Test

```bash
export MODE="local"
export TEMPORAL_SERVICE_ADDRESS="localhost:7233"
export STIGMER_BACKEND_ENDPOINT="localhost:50051"
python -m backend.services.agent-runner.main
```

Expected output:
```
🚀 Stigmer Agent Runner - LOCAL Mode
...
Local mode: Skipping Redis initialization (using gRPC to Stigmer Daemon)
🔧 Execution Mode: LOCAL
🔧 Stigmer Backend: localhost:50051
🔧 Sandbox: filesystem (root: ./workspace)
✅ [POLYGLOT] Connected to Temporal server...
```

### Cloud Mode Test

```bash
export MODE="cloud"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export STIGMER_API_KEY="<valid-key>"
python -m backend.services.agent-runner.main
```

Expected output:
```
🚀 Stigmer Agent Runner - CLOUD Mode
...
✅ Connected to Redis at localhost:6379
🔧 Execution Mode: CLOUD
🔧 Stigmer Backend: localhost:8080
🔧 Sandbox: daytona
🔧 Redis: localhost:6379
✅ [POLYGLOT] Connected to Temporal server...
```

## Related Tasks

- **T1**: Implemented `execute()` in FilesystemBackend ✅
- **T2**: Updated Agent Runner config for local mode detection ✅
- **T3**: Updated Agent Runner main to connect to Stigmer Daemon gRPC ✅ (this change)
- **T4**: Implement secret injection in Stigmer CLI/Daemon (next)

## References

- ADR: `stigmer/_cursor/adr-doc` (Section 2: Configuration & Dependencies)
- Project: `stigmer/_projects/2026-01/20260119.01.agent-runner-local-mode/`
- Config: `stigmer/backend/services/agent-runner/worker/config.py`
