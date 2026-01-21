# Fix: Agent-Runner Docker Container Cannot Connect to Ollama

**Date**: 2026-01-22 04:24:55  
**Type**: Bug Fix (Critical)  
**Scope**: CLI Daemon, Agent Execution  
**Impact**: High - Agent execution was completely broken in local mode

## Summary

Fixed a critical bug where the agent-runner Docker container could not connect to Ollama running on the host machine, causing all agent executions to fail with "All connection attempts failed" error.

The issue was that `llmBaseURL` was being passed directly to the Docker container without hostname resolution, using `localhost:11434` which from inside a Docker container refers to the container itself, not the host machine.

## Problem

When running `stigmer run` with an agent configured to use Ollama (the default for local mode), the execution would fail immediately with:

```
✗ ❌ Execution failed
ℹ️ System: ❌ Error: Execution failed: All connection attempts failed
```

**Root Cause:**

In `daemon.go`, the `startAgentRunner()` function was passing `llmBaseURL` directly to the Docker container:

```go
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),  // ❌ Wrong
```

The `llmBaseURL` resolves to `http://localhost:11434` by default (from `config.go:289`), but from inside a Docker container on macOS/Windows, `localhost` refers to the container itself, not the Docker host.

**Why it happened:**

The daemon was already correctly using `resolveDockerHostAddress()` for other services:
- Temporal: `host.docker.internal:7233` ✅
- Stigmer Backend: `host.docker.internal:7234` ✅
- Ollama: `localhost:11434` ❌ (missed this one!)

The Ollama base URL was not being resolved through the same function.

## Solution

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

### Change 1: Resolve Ollama Base URL

Added hostname resolution for `llmBaseURL` before passing to Docker container:

```go
// Before
hostAddr := resolveDockerHostAddress(temporalAddr)
backendAddr := resolveDockerHostAddress(fmt.Sprintf("localhost:%d", DaemonPort))

// After
hostAddr := resolveDockerHostAddress(temporalAddr)
backendAddr := resolveDockerHostAddress(fmt.Sprintf("localhost:%d", DaemonPort))
llmBaseURLResolved := resolveDockerHostAddress(llmBaseURL)  // ✅ Added
```

### Change 2: Use Resolved URL in Docker Args

Updated Docker environment variable to use the resolved URL:

```go
// Before
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),

// After  
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURLResolved),
```

### Change 3: Add to Log Output

Added `llm_base_url` to startup log for visibility:

```go
log.Info().
    Str("llm_provider", llmProvider).
    Str("llm_model", llmModel).
    Str("llm_base_url", llmBaseURLResolved).  // ✅ Added
    Str("temporal_address", hostAddr).
    Str("backend_address", backendAddr).
    Str("execution_mode", executionMode).
    Str("sandbox_image", sandboxImage).
    Str("image", AgentRunnerDockerImage).
    Msg("Starting agent-runner Docker container")
```

## How resolveDockerHostAddress() Works

The function automatically handles platform differences:

```go
func resolveDockerHostAddress(addr string) string {
    // Only convert localhost addresses
    if !strings.Contains(addr, "localhost") && !strings.Contains(addr, "127.0.0.1") {
        return addr
    }
    
    // On Linux, localhost works with --network host
    if runtime.GOOS == "linux" {
        return addr  // Keep localhost
    }
    
    // On macOS/Windows (darwin/windows), use host.docker.internal
    addr = strings.ReplaceAll(addr, "localhost", "host.docker.internal")
    addr = strings.ReplaceAll(addr, "127.0.0.1", "host.docker.internal")
    
    return addr
}
```

**Result:**
- **macOS/Windows**: `http://localhost:11434` → `http://host.docker.internal:11434` ✅
- **Linux**: `http://localhost:11434` → `http://localhost:11434` (unchanged, works with `--network host`)

## Verification

### Before Fix

```bash
$ stigmer run
✓ Deployed: 1 agent(s) and 1 workflow(s)
? Select resource to run: [Agent] pr-reviewer

ℹ Creating agent execution...
✓ Agent execution started: pr-reviewer

✓ Streaming agent execution logs
ℹ ⏳ Execution pending...
✓ ▶️  Execution started
✗ ❌ Execution failed

ℹ️ System: ❌ Error: Execution failed: All connection attempts failed
```

**Logs showed:**
```
[agent-runner] 2026-01-21 22:46:08,661 - temporalio.activity - ERROR - ExecuteGraphton failed for execution aex-xxx: All connection attempts failed
```

### After Fix

```bash
$ make build && stigmer server restart
$ stigmer run
✓ Deployed: 1 agent(s) and 1 workflow(s)
? Select resource to run: [Agent] pr-reviewer

ℹ Creating agent execution...
✓ Agent execution started: pr-reviewer

✓ Streaming agent execution logs
ℹ ⏳ Execution pending...
✓ ▶️  Execution started
✓ 🤖 Agent connected to Ollama successfully
✓ ✅ Execution completed
```

**Startup logs now show:**
```
Starting agent-runner Docker container
  llm_provider=ollama
  llm_model=qwen2.5-coder:7b
  llm_base_url=http://host.docker.internal:11434  ← ✅ Resolved correctly
  temporal_address=host.docker.internal:7233
  backend_address=host.docker.internal:7234
```

## Technical Details

### Docker Networking on macOS/Windows

Docker Desktop on macOS and Windows runs in a virtual machine. Containers cannot reach the host via `localhost` - they need to use the special hostname `host.docker.internal` which Docker provides for this purpose.

### Docker Networking on Linux

On Linux, Docker runs natively (no VM). The daemon uses `--network host` mode, which allows containers to use `localhost` directly to reach host services.

### LLM Configuration Cascade

The Ollama base URL comes from a configuration cascade (highest priority first):

1. **Environment variable**: `STIGMER_LLM_BASE_URL`
2. **Config file**: `.stigmer/config.yaml` → `backend.local.llm.base_url`
3. **Hard-coded default**: `http://localhost:11434` (for Ollama provider)

This bug affected all three sources since the resolution step was missing entirely.

## Impact

**Before this fix:**
- ❌ Agent execution completely broken in local mode on macOS/Windows
- ❌ All agent runs failed with "All connection attempts failed"
- ❌ No way to test agents locally without external Ollama setup

**After this fix:**
- ✅ Agent execution works out-of-the-box in local mode
- ✅ Docker container can reach Ollama on host machine
- ✅ Consistent hostname resolution across all services (Temporal, Backend, Ollama)

## Side Note: Model Availability

During debugging, we also:
- Verified `qwen2.5-coder:14b` was already available on the system
- Downloaded `qwen2.5-coder:7b` (the default model)
- Documented how to change models via environment variable (`STIGMER_LLM_MODEL`)

Users can use either model - the configuration is flexible and no code changes are needed to switch models.

## Files Changed

```
client-apps/cli/internal/cli/daemon/daemon.go
- Line 634: Added llmBaseURLResolved = resolveDockerHostAddress(llmBaseURL)
- Line 666: Changed to use llmBaseURLResolved
- Line 697: Added llm_base_url to log output
```

## Testing Recommendations

After this fix, test:
1. `stigmer server restart` - Verify agent-runner starts with resolved URL
2. `stigmer run` - Select an agent and verify execution completes
3. Check logs: `stigmer server logs agent-runner` - Should show successful Ollama connection
4. Test with different models: `export STIGMER_LLM_MODEL=qwen2.5-coder:14b && stigmer server restart`

## Related Issues

This same pattern should be checked for any future host services that the agent-runner Docker container needs to connect to. Always use `resolveDockerHostAddress()` when passing host URLs to Docker containers.

## Lessons Learned

1. **Cross-platform Docker networking is tricky** - Always test on macOS/Windows (Docker in VM) and Linux (Docker native)
2. **Consistency is key** - If some addresses are resolved, all should be
3. **Log what you configure** - Adding `llm_base_url` to logs made debugging easier
4. **Error messages should be specific** - "All connection attempts failed" is generic; could be improved to show which host/port failed

## Prevention

**Code review checklist item:**
- [ ] When adding new host services for Docker containers, ensure hostname is resolved via `resolveDockerHostAddress()`

**Future improvement:**
- Consider adding health checks that verify agent-runner can reach all configured services (Temporal, Backend, Ollama)
- Add better error messages that show the actual connection URL attempted

---

**Status**: ✅ Fixed and verified  
**Priority**: P0 (Critical - blocked all agent execution)  
**Affected Versions**: All versions prior to this fix  
**Platform**: macOS and Windows (Linux was unaffected due to `--network host`)
