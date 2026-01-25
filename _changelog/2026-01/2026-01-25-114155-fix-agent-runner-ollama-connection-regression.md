# Fix: Agent-Runner Ollama Connection Regression

**Date**: 2026-01-25 11:41:55  
**Type**: Bug Fix (Critical)  
**Scope**: Agent Runner, Supervisor, Environment Configuration  
**Impact**: Critical - Fixes agent execution failures after daemon restart

## Summary

Fixed a critical regression where agent-runner could not connect to Ollama, causing all agent executions to fail with "All connection attempts failed" error. The issue was that the supervisor was only setting `STIGMER_LLM_BASE_URL` but not `OLLAMA_BASE_URL`, which the agent-runner code actually reads.

This was a **regression** from the previous fix documented in `2026-01-22-051454-fix-ollama-langchain-explicit-base-url.md`, where the fix specified that BOTH environment variables must be set for compatibility.

## Problem

### Symptoms

After restarting the stigmer daemon, agent execution tests failed:

```
TestE2E/TestRunBasicAgent - FAILED
TestE2E/TestRunFullAgent - FAILED

Error: "Execution failed: All connection attempts failed"
```

Agent executions would:
1. Create successfully
2. Transition to IN_PROGRESS
3. Immediately fail with connection error

### Root Cause

The supervisor (`backend/services/stigmer-server/pkg/supervisor/supervisor.go`) was only setting:
```go
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
```

But the agent-runner configuration (`backend/services/agent-runner/worker/config.py`) reads:
```python
base_url = os.getenv("OLLAMA_BASE_URL", default_base_url)
```

**Mismatch**: Supervisor sets `STIGMER_LLM_BASE_URL` → Agent-runner reads `OLLAMA_BASE_URL` → Falls back to default `http://localhost:11434` → Connection fails from Docker container

### Why It Worked Before

According to changelog `2026-01-22-051454-fix-ollama-langchain-explicit-base-url.md`, this was already fixed on January 22nd by setting **BOTH** environment variables:

```go
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURLResolved),  // Legacy
"-e", fmt.Sprintf("OLLAMA_BASE_URL=%s", llmBaseURLResolved),       // Standard
```

However, the supervisor code somehow reverted to only setting `STIGMER_LLM_BASE_URL`, causing the regression.

## Investigation Process

### 1. Initial Diagnosis

User reported tests failing after daemon restart on new network. Initial hypothesis was network-related, but:

```bash
# Docker connectivity test
$ docker exec stigmer-agent-runner python3 -c "import socket; print(socket.gethostbyname('host.docker.internal'))"
192.168.65.254  # ✅ Resolves correctly

# HTTP connectivity test
$ docker exec stigmer-agent-runner python3 -c "from urllib.request import urlopen; urlopen('http://host.docker.internal:11434/api/tags')"
# ✅ Works - returns 200
```

Network was fine. The issue was environment variable configuration.

### 2. Environment Variable Check

Checked what the container actually sees:

```bash
$ docker inspect stigmer-agent-runner --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "OLLAMA|STIGMER_LLM"
STIGMER_LLM_BASE_URL=http://host.docker.internal:11434  # ✅ Set
OLLAMA_BASE_URL=<not set>                                # ❌ Missing
```

```bash
$ docker exec stigmer-agent-runner python3 -c "import os; print('STIGMER_LLM_BASE_URL:', os.getenv('STIGMER_LLM_BASE_URL')); print('OLLAMA_BASE_URL:', os.getenv('OLLAMA_BASE_URL'))"
STIGMER_LLM_BASE_URL: http://host.docker.internal:11434
OLLAMA_BASE_URL: None  # ❌ Not set
```

### 3. Code Analysis

Checked what the agent-runner reads:

```python
# backend/services/agent-runner/worker/config.py:122
base_url = os.getenv("OLLAMA_BASE_URL", default_base_url)
```

Checked what the supervisor sets:

```go
// backend/services/stigmer-server/pkg/supervisor/supervisor.go:281
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
// Missing: OLLAMA_BASE_URL
```

### 4. Changelog Review

Found the original fix in `2026-01-22-051454-fix-ollama-langchain-explicit-base-url.md`:

> All four fixes are required for agent execution to work:
> 1. Hostname resolution (daemon.go)
> 2. Network binding (Ollama plist)
> 3. **Both env vars** (daemon.go) ← This one
> 4. Explicit base_url (execute_graphton.py)

The fix specified that **BOTH** variables must be set, but somehow the supervisor code didn't have this.

## Solution

### Fix Applied

**File**: `backend/services/stigmer-server/pkg/supervisor/supervisor.go`

**Added the missing environment variable**:

```go
"-e", fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", s.config.LLMProvider),
"-e", fmt.Sprintf("STIGMER_LLM_MODEL=%s", s.config.LLMModel),
"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
"-e", fmt.Sprintf("OLLAMA_BASE_URL=%s", llmBaseURL), // LangChain standard variable ← ADDED
)
```

**Why both variables are needed**:
- `STIGMER_LLM_BASE_URL` - Legacy/backup (for old container images)
- `OLLAMA_BASE_URL` - Standard LangChain variable (what the code actually reads)

### Rebuild and Restart

1. **Rebuilt CLI** (contains supervisor code):
   ```bash
   make release-local
   ```

2. **Rebuilt agent-runner** (for consistency):
   ```bash
   make build-agent-runner-image
   ```

3. **Restarted daemon**:
   ```bash
   stigmer server restart
   ```

### Verification

After the fix:

```bash
# Both environment variables now set
$ docker exec stigmer-agent-runner python3 -c "import os; print('STIGMER_LLM_BASE_URL:', os.getenv('STIGMER_LLM_BASE_URL')); print('OLLAMA_BASE_URL:', os.getenv('OLLAMA_BASE_URL'))"
STIGMER_LLM_BASE_URL: http://host.docker.internal:11434  ✅
OLLAMA_BASE_URL: http://host.docker.internal:11434       ✅
```

Agent-runner logs show correct connection:

```
Created ChatOllama with base_url=http://host.docker.internal:11434
```

## Test Results

### Before Fix

```
=== RUN   TestE2E/TestRunBasicAgent
    agent_test_helpers.go:273:    [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_FAILED
    agent_test_helpers.go:286:    ❌ Execution FAILED after 1 polls
    agent_test_helpers.go:289:       Error: ❌ Error: Execution failed: All connection attempts failed
--- FAIL: TestE2E/TestRunBasicAgent (1.51s)

=== RUN   TestE2E/TestRunFullAgent
    agent_test_helpers.go:273:    [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_FAILED
    agent_test_helpers.go:286:    ❌ Execution FAILED after 1 polls
    agent_test_helpers.go:289:       Error: ❌ Error: Execution failed: All connection attempts failed
--- FAIL: TestE2E/TestRunFullAgent (1.49s)
```

### After Fix

```
=== RUN   TestE2E/TestRunBasicAgent
    agent_test_helpers.go:273:    [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_IN_PROGRESS
    agent_test_helpers.go:273:    [Poll 21] Phase transition: EXECUTION_IN_PROGRESS → EXECUTION_COMPLETED
    agent_test_helpers.go:281:    ✓ Execution completed successfully after 21 polls
    basic_agent_run_basic_test.go:38: ✅ Test Passed!
--- PASS: TestE2E/TestRunBasicAgent (21.43s)

=== RUN   TestE2E/TestRunFullAgent
    agent_test_helpers.go:273:    [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_IN_PROGRESS
    agent_test_helpers.go:273:    [Poll 10] Phase transition: EXECUTION_IN_PROGRESS → EXECUTION_COMPLETED
    agent_test_helpers.go:281:    ✓ Execution completed successfully after 10 polls
    basic_agent_run_full_test.go:39: ✅ Full Agent Run Test Passed!
--- PASS: TestE2E/TestRunFullAgent (10.50s)
```

Both tests now pass successfully! ✅

## Impact

**Before fix:**
- ❌ Agent execution completely broken
- ❌ "All connection attempts failed" error
- ❌ Tests failing
- ❌ No way to run agents locally

**After fix:**
- ✅ Agent execution works end-to-end
- ✅ Both environment variables set correctly
- ✅ Tests passing (21.43s and 10.50s execution times)
- ✅ Agent-runner successfully connects to Ollama
- ✅ Local development workflow fully functional

## Files Changed

```
backend/services/stigmer-server/pkg/supervisor/supervisor.go
- Line 282: Added OLLAMA_BASE_URL environment variable
```

## Lessons Learned

### Why This Regression Happened

1. **Code reverted**: The January 22nd fix was somehow not present in supervisor code
2. **Multiple fix locations**: The original fix was in `daemon.go`, but agent-runner is now managed by supervisor
3. **No cross-reference**: Supervisor code didn't have comments referencing the environment variable requirement

### Prevention Strategies

1. **Document environment variable contracts**: Add comments explaining why both variables are needed
2. **Centralize configuration**: Consider a shared configuration struct for Docker container env vars
3. **E2E tests**: The E2E tests caught this regression immediately - very valuable
4. **Changelog references**: Link related fixes so regressions are easier to spot

### Code Review Checklist

When modifying agent-runner startup:
- [ ] Both `STIGMER_LLM_BASE_URL` and `OLLAMA_BASE_URL` are set
- [ ] `host.docker.internal` is used (not `localhost`)
- [ ] Environment variables match what agent-runner actually reads
- [ ] E2E tests pass (agent execution tests)

## Related Issues

This completes the full fix chain from January 22nd:

| Fix | Component | What It Does | Status |
|-----|-----------|--------------|--------|
| 1 | daemon.go | Hostname resolution (`host.docker.internal`) | ✅ |
| 2 | Ollama plist | Network binding (`0.0.0.0:11434`) | ✅ |
| 3a | daemon.go | Both env vars for daemon-managed container | ✅ (Jan 22) |
| 3b | supervisor.go | Both env vars for supervisor-managed container | ✅ (This fix) |
| 4 | execute_graphton.py | Explicit base_url parameter | ✅ |

## Technical Details

### Environment Variable Priority

The agent-runner config reads environment variables in this order:

```python
# backend/services/agent-runner/worker/config.py
base_url = os.getenv("OLLAMA_BASE_URL", default_base_url)
```

**Key insight**: The code **only** reads `OLLAMA_BASE_URL`, not `STIGMER_LLM_BASE_URL`.

**Why set both?**
- Backward compatibility: Old container images might read different variable
- Safety: If code changes to read the other variable, it's already set
- Clarity: Makes it obvious what the LLM base URL is

### LangChain Standard

`OLLAMA_BASE_URL` is the standard environment variable for LangChain's Ollama integration:

```python
# LangChain expects this variable
from langchain_ollama import ChatOllama
# If OLLAMA_BASE_URL is set, ChatOllama will use it
# If not set, it defaults to http://localhost:11434
```

## Verification Commands

For future troubleshooting:

```bash
# 1. Check supervisor sets both variables
docker inspect stigmer-agent-runner --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E "OLLAMA|STIGMER_LLM"

# 2. Check container can resolve host
docker exec stigmer-agent-runner python3 -c "import socket; print(socket.gethostbyname('host.docker.internal'))"

# 3. Check HTTP connectivity to Ollama
docker exec stigmer-agent-runner python3 -c "from urllib.request import urlopen; print(urlopen('http://host.docker.internal:11434/api/tags').status)"

# 4. Run the failing tests
cd test/e2e && go test -v -tags=e2e -timeout 60s -run "TestE2E/(TestRunBasicAgent|TestRunFullAgent)$"
```

Expected output:
1. Both `STIGMER_LLM_BASE_URL=http://host.docker.internal:11434` and `OLLAMA_BASE_URL=http://host.docker.internal:11434`
2. `192.168.65.254` (or similar Docker host IP)
3. `200`
4. Both tests pass

---

**Status**: ✅ Fixed and verified  
**Priority**: P0 (Critical - broke all agent execution)  
**Affected Versions**: After January 22nd (regression)  
**Platform**: All platforms (macOS, Linux, Windows)  
**Testing**: E2E tests passing
