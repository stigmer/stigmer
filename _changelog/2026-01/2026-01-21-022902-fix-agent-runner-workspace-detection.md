# Fix: Agent-Runner Workspace Detection with Explicit Environment Variable

**Date**: 2026-01-21  
**Impact**: Critical - Agent-runner failed to start in production mode  
**Scope**: `client-apps/cli/`, `backend/services/agent-runner/`

## Problem

Agent-runner failed to start when launched by the stigmer daemon with error:

```
[agent-runner] Error: Could not find workspace root
```

### Root Cause

The `run.sh` launcher script needed to locate the workspace root (where `pyproject.toml` lives) but had no explicit mechanism for production mode:

1. **`BUILD_WORKSPACE_DIRECTORY`** - Only set by Bazel, not by daemon
2. **Directory tree walking** - Failed because extracted binaries in `~/.stigmer/data/bin/agent-runner/` have no `MODULE.bazel` or `WORKSPACE` file

The daemon extracted agent-runner to `~/.stigmer/data/bin/agent-runner/` but didn't tell the script where that was. The script tried to walk up the directory tree looking for `MODULE.bazel`, failed, and exited.

**Design flaw**: Implicit workspace detection via directory tree walking. Production mode had no explicit communication channel.

## Solution

### 1. Explicit Environment Variable: `STIGMER_AGENT_RUNNER_WORKSPACE`

Introduced explicit environment variable for production mode:

```bash
STIGMER_AGENT_RUNNER_WORKSPACE=/path/to/agent-runner/workspace
```

**Precedence order** (explicit to implicit):
1. **`STIGMER_AGENT_RUNNER_WORKSPACE`** - Production/explicit mode
2. **`BUILD_WORKSPACE_DIRECTORY`** - Bazel mode
3. **Directory tree walking** - Development mode fallback

### 2. Daemon Sets Workspace Automatically

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

```go
// Determine agent-runner workspace directory
// This is where pyproject.toml and Python source code live
agentRunnerWorkspace := filepath.Dir(runnerScript) // Directory containing run.sh

env = append(env,
    // ... other env vars ...
    fmt.Sprintf("STIGMER_AGENT_RUNNER_WORKSPACE=%s", agentRunnerWorkspace),
)
```

**How it works**:
- Daemon knows where it extracted agent-runner: `dataDir/bin/agent-runner/`
- `runnerScript` = `dataDir/bin/agent-runner/run.sh`
- `agentRunnerWorkspace` = `filepath.Dir(runnerScript)` = `dataDir/bin/agent-runner/`
- Daemon passes this as `STIGMER_AGENT_RUNNER_WORKSPACE` environment variable

### 3. Enhanced run.sh with Clear Precedence

**File**: `backend/services/agent-runner/run.sh`

```bash
# Determine workspace root with explicit precedence order:
# 1. STIGMER_AGENT_RUNNER_WORKSPACE (production mode - set by stigmer daemon)
# 2. BUILD_WORKSPACE_DIRECTORY (Bazel mode - set by 'bazel run')
# 3. Directory tree walking (development mode - find MODULE.bazel/WORKSPACE)

if [ -n "${STIGMER_AGENT_RUNNER_WORKSPACE:-}" ]; then
    # Production mode: daemon explicitly sets the workspace location
    WORKSPACE_ROOT="${STIGMER_AGENT_RUNNER_WORKSPACE}"
    
elif [ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    # Bazel mode: running via 'bazel run'
    WORKSPACE_ROOT="${BUILD_WORKSPACE_DIRECTORY}"
    
else
    # Development mode: find workspace root by walking up directory tree
    # ... [directory walking logic] ...
fi
```

### 4. Improved Error Messages

**Before**:
```
Error: Could not find workspace root
```

**After**:
```
Error: Could not determine workspace root

This script supports three execution modes:
  1. Production: Set STIGMER_AGENT_RUNNER_WORKSPACE=/path/to/extracted/agent-runner
  2. Bazel:      Run with 'bazel run //backend/services/agent-runner'
  3. Development: Run from within stigmer source tree (has MODULE.bazel)

Current directory: /home/user/.stigmer/data/bin/agent-runner
```

### 5. Enhanced Logging

Added workspace path to daemon logs:

```go
log.Info().
    Str("llm_provider", llmProvider).
    Str("llm_model", llmModel).
    Str("temporal_address", temporalAddr).
    Str("workspace", agentRunnerWorkspace).  // NEW
    Msg("Starting agent-runner with configuration")
```

## Changes Made

### Modified Files

1. **`backend/services/agent-runner/run.sh`**
   - Added `STIGMER_AGENT_RUNNER_WORKSPACE` as highest priority detection method
   - Improved comments explaining each detection mode
   - Enhanced error messages with actionable guidance

2. **`client-apps/cli/internal/cli/daemon/daemon.go`**
   - Calculate `agentRunnerWorkspace` from `runnerScript` path
   - Set `STIGMER_AGENT_RUNNER_WORKSPACE` environment variable
   - Log workspace path for debugging

3. **`client-apps/cli/README.md`**
   - Documented workspace detection mechanism
   - Explained precedence order
   - Clarified automatic configuration in production

4. **`backend/services/agent-runner/README.md`**
   - Added "Execution Modes" section
   - Documented all three modes with examples
   - Explained precedence order

## Design Principles Applied

### 1. Explicit Over Implicit

**Before**: Implicit workspace detection via directory tree walking  
**After**: Explicit environment variable set by daemon

**Why**: Production systems should not rely on heuristics when the caller knows the answer.

### 2. Clear Precedence Order

```
Explicit (production) → Conventional (Bazel) → Heuristic (development)
```

Each mode has a clear trigger and fallback chain.

### 3. Self-Documenting Errors

Error messages explain:
- What went wrong
- What the script needs
- How to fix it in each mode
- Current context (directory)

### 4. No Breaking Changes

All existing modes continue to work:
- Bazel: `BUILD_WORKSPACE_DIRECTORY` still works
- Development: Directory tree walking still works
- Production: Now works with new env var

## Testing

### Test Case 1: Production Mode (Extracted Binaries)

```bash
stigmer server start
stigmer server logs --all
```

**Expected**: Agent-runner starts successfully, no "Could not find workspace root" error

**Verification**:
```
[agent-runner] 2026/01/21 02:24:14 INFO Started Worker...
```

### Test Case 2: Bazel Mode

```bash
bazel run //backend/services/agent-runner
```

**Expected**: Uses `BUILD_WORKSPACE_DIRECTORY`, runs from source tree

### Test Case 3: Development Mode

```bash
cd backend/services/agent-runner
./run.sh
```

**Expected**: Finds workspace root via directory tree walking

### Test Case 4: Error Message Quality

```bash
cd /tmp
/path/to/extracted/run.sh
```

**Expected**: Clear error explaining all three modes and current context

## Benefits

### 1. Reliability

- **Production mode now works** - No more "Could not find workspace root" errors
- **Explicit communication** - No guessing, no heuristics in production
- **Predictable behavior** - Same precedence order every time

### 2. Debuggability

- **Logged workspace path** - Visible in daemon logs
- **Clear error messages** - Actionable guidance for all modes
- **Documented behavior** - README explains all modes

### 3. Developer Experience

- **No manual configuration** - Daemon sets env var automatically
- **All modes preserved** - Bazel and dev mode unchanged
- **Self-documenting** - Script explains itself on error

### 4. State-of-the-Art Engineering

- **Explicit over implicit** - Production gets explicit configuration
- **Fail-fast with guidance** - Errors are informative, not mysterious
- **Layered fallbacks** - Explicit → Conventional → Heuristic
- **No workarounds needed** - Works out of the box

## Comparison: Before vs After

### Before (Broken in Production)

```
Production Mode:
  ❌ No BUILD_WORKSPACE_DIRECTORY (not running via Bazel)
  ❌ No MODULE.bazel in ~/.stigmer/data/bin/agent-runner/
  ❌ Directory walking fails
  💥 Error: Could not find workspace root
```

### After (Works Everywhere)

```
Production Mode:
  ✅ Daemon sets STIGMER_AGENT_RUNNER_WORKSPACE
  ✅ Script uses explicit workspace path
  ✅ Agent-runner starts successfully
  🎉 No errors

Bazel Mode:
  ✅ BUILD_WORKSPACE_DIRECTORY set by Bazel
  ✅ Works as before

Development Mode:
  ✅ Directory tree walking finds MODULE.bazel
  ✅ Works as before
```

## Impact Assessment

### User-Facing

- **Eliminated startup error** - Agent-runner now starts reliably
- **No configuration needed** - Works automatically in all modes
- **Better error messages** - If something goes wrong, clear guidance

### Developer-Facing

- **Clearer architecture** - Explicit workspace communication
- **Better logs** - Workspace path visible in daemon logs
- **Documented modes** - README explains all execution modes

### Production

- **Zero manual setup** - Daemon handles everything
- **Reliable execution** - No heuristic failures
- **Observable** - Workspace path in logs

## Related Issues

This fix eliminates an entire class of "workspace not found" issues by:
1. Making workspace location explicit in production
2. Preserving all existing modes (Bazel, dev)
3. Improving error messages for debugging

## Migration Guide

### For Users

**No action needed**. The fix is automatic when you upgrade:

```bash
brew upgrade stigmer  # or download latest release
stigmer server restart
```

### For Developers

**No action needed**. All existing workflows continue to work:

```bash
# Bazel mode (unchanged)
bazel run //backend/services/agent-runner

# Development mode (unchanged)
cd backend/services/agent-runner && ./run.sh

# Manual testing with explicit workspace
STIGMER_AGENT_RUNNER_WORKSPACE=$(pwd) ./run.sh
```

## Lessons Learned

### 1. Avoid Implicit Heuristics in Production

**Problem**: Directory tree walking is a development convenience, not a production strategy.

**Solution**: Explicit environment variables for production, with heuristics as fallback for dev.

### 2. The Caller Knows Best

**Problem**: Script tried to discover workspace through filesystem inspection.

**Solution**: Daemon knows where it extracted files—just tell the script.

### 3. Fail with Guidance

**Problem**: Generic "Could not find workspace root" error with no context.

**Solution**: Explain what the script needs, what modes exist, and current state.

### 4. Design for Multiple Modes

**Problem**: Single detection mechanism (directory walking) didn't work everywhere.

**Solution**: Layered detection with clear precedence: explicit → conventional → heuristic.

## Conclusion

This fix transforms workspace detection from **implicit heuristic** to **explicit communication** while preserving all existing modes. The result is a **production-ready, state-of-the-art solution** that:

- Works reliably in all execution modes
- Requires zero manual configuration
- Provides clear error messages when things go wrong
- Follows software engineering best practices

**Engineering principle applied**: Explicit is better than implicit. The daemon knows where the workspace is—it should just say so.
