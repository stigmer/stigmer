# Fix: Agent-Runner Docker Container Cannot Connect to Ollama

**Date**: 2026-01-22 04:24:55  
**Type**: Bug Fix (Critical)  
**Scope**: CLI Daemon, Agent Execution  
**Impact**: High - Agent execution was completely broken in local mode

## Summary

Fixed a critical bug where the agent-runner Docker container could not connect to Ollama running on the host machine, causing all agent executions to fail with "All connection attempts failed" error.

**Root Causes:**
1. **Missing hostname resolution**: `llmBaseURL` was using `localhost:11434` which from inside a Docker container refers to the container itself, not the host machine.
2. **Missing standard environment variable**: LangChain reads `OLLAMA_BASE_URL` directly from the environment for Ollama connections. We were setting a custom `STIGMER_LLM_BASE_URL` variable that wasn't being used anywhere.

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

### Change 2: Set OLLAMA_BASE_URL (Standard LangChain Variable)

Removed the unused custom `STIGMER_LLM_BASE_URL` and set only the standard `OLLAMA_BASE_URL` that LangChain reads directly:

```go
// Before
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),

// After  
// OLLAMA_BASE_URL is the standard env var expected by LangChain for Ollama
"-e", fmt.Sprintf("OLLAMA_BASE_URL=%s", llmBaseURLResolved),  // ✅ Set standard variable
```

**Why only OLLAMA_BASE_URL?**
- LangChain's Ollama integration reads `OLLAMA_BASE_URL` directly from the environment
- Our custom `STIGMER_LLM_BASE_URL` was never being used by the actual code
- Using standard environment variables follows the principle of least surprise

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

**Container environment variables:**
```bash
$ docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep OLLAMA
OLLAMA_BASE_URL=http://host.docker.internal:11434  ← ✅ Standard LangChain variable
```

## Technical Details

### Docker Networking on macOS/Windows

Docker Desktop on macOS and Windows runs in a virtual machine. Containers cannot reach the host via `localhost` - they need to use the special hostname `host.docker.internal` which Docker provides for this purpose.

### Docker Networking on Linux

On Linux, Docker runs natively (no VM). The daemon uses `--network host` mode, which allows containers to use `localhost` directly to reach host services.

### LangChain Ollama Integration

LangChain's Ollama ChatModel reads the `OLLAMA_BASE_URL` environment variable directly:
- **Standard behavior**: If `OLLAMA_BASE_URL` is not set, it defaults to `http://localhost:11434`
- **In Docker**: `localhost` refers to the container itself, not the host machine
- **Our fix**: Set `OLLAMA_BASE_URL=http://host.docker.internal:11434` in the container

### Configuration Simplification

**Before**: We had a custom `STIGMER_LLM_BASE_URL` variable that was read into our config but never actually used. Graphton/LangChain always read `OLLAMA_BASE_URL` directly from the environment.

**After**: Removed the unused abstraction and use only the standard `OLLAMA_BASE_URL` that LangChain expects. This follows standard conventions and reduces confusion.

**Why this is better**:
- ✅ Uses standard environment variables that developers already know
- ✅ Eliminates unnecessary abstraction layer
- ✅ No confusion about which variable actually matters
- ✅ Follows the principle of least surprise

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
- Line 666: Removed unused STIGMER_LLM_BASE_URL
- Line 666: Set OLLAMA_BASE_URL environment variable (standard for LangChain)
- Line 698: Added llm_base_url to log output

backend/services/agent-runner/worker/config.py
- Line 90: Updated docs to reference OLLAMA_BASE_URL instead of STIGMER_LLM_BASE_URL
- Line 120: Changed to read OLLAMA_BASE_URL instead of STIGMER_LLM_BASE_URL
- Line 169: Updated validation error to mention OLLAMA_BASE_URL
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
