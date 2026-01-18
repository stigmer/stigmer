# Checkpoint: T3 - Worker Daemon Connection Complete

**Date**: January 19, 2026  
**Task**: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC  
**Status**: ✅ Complete

## What Was Accomplished

Successfully updated Agent Runner worker and main entry point to support mode-aware initialization with proper Redis connection handling, enhanced error handling, and graceful shutdown.

## Changes Made

### 1. Worker Class (`worker/worker.py`)

- Added Redis client initialization (cloud mode only)
- Created `_initialize_redis()` private method with error handling
- Added `shutdown()` method for graceful cleanup
- Enhanced logging to show execution mode and configuration
- Added mode-aware connection handling
- Proper error handling for Redis and Temporal connections

### 2. Main Entry Point (`main.py`)

- Added startup banner showing mode (LOCAL/CLOUD) and configuration
- Enhanced error handling for config loading and worker initialization
- Fixed outdated reference to non-existent `rotation_task`
- Simplified shutdown handler to use new `worker.shutdown()` method
- Added KeyboardInterrupt handling
- Improved logging for debugging

## Architecture

### Local Mode Flow
```
Agent Runner → MODE=local
    ↓
Skip Redis init
    ↓
Connect to Stigmer Daemon gRPC (localhost:50051)
    ↓
Use filesystem sandbox (./workspace)
    ↓
API key = "dummy-local-key"
```

### Cloud Mode Flow
```
Agent Runner → MODE=cloud
    ↓
Initialize Redis connection
    ↓
Connect to cloud backend gRPC
    ↓
Use Daytona sandbox
    ↓
API key = validated JWT
```

## Key Decisions

1. **Conditional Initialization**: Redis only initialized in cloud mode (not created then closed)
2. **Fail-Fast**: Configuration errors cause immediate exit with clear messages
3. **Graceful Shutdown**: Worker stops accepting tasks, waits for in-flight activities
4. **Centralized Cleanup**: All cleanup logic in `worker.shutdown()` method
5. **Mode Visibility**: Startup banner makes it obvious which mode is running
6. **No gRPC Changes**: Existing `AgentExecutionClient` already mode-aware

## What's Working

- gRPC client automatically connects to correct endpoint based on mode
- API key handling is mode-aware
- Sandbox configuration returns appropriate values for each mode
- Redis connection is cleanly managed in cloud mode
- Local mode completely bypasses Redis

## Files Modified

- `backend/services/agent-runner/worker/worker.py` (34 lines added)
- `backend/services/agent-runner/main.py` (refactored with better error handling)

## Documentation Created

- Changelog: `_changelog/2026-01/2026-01-19-030000-agent-runner-local-cloud-mode-switching.md`
- Project notes: `_projects/2026-01/20260119.01.agent-runner-local-mode/notes.md` (T3 section)
- Next task: `_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md` (updated)

## Testing Evidence

- No linter errors in modified files
- Code follows existing patterns and conventions
- Backward compatible with cloud mode
- Clear error messages for connection failures

## Next Steps

**T4**: Implement secret injection in Stigmer CLI/Daemon
- Create `stigmer local start` command in Go CLI
- Detect missing `ANTHROPIC_API_KEY`
- Prompt user for API key (masked input)
- Spawn Agent Runner subprocess with injected environment
- Handle supervisor lifecycle

## References

- ADR: `_cursor/adr-doc` (Section 2: Configuration & Dependencies)
- Previous checkpoint: T2 complete (config for local mode detection)
- Next checkpoint: T4 (secret injection in CLI/Daemon)
