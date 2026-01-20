# Fix: Server Restart - Eliminate Orphaned Processes

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: CLI - Daemon Management  
**Impact**: High - Fixes critical server lifecycle issue

## Problem

`stigmer server restart` was creating orphaned server processes without PID files, causing `stigmer apply` to show "🚀 Starting local backend daemon..." on every run even though the server was already running.

### Root Cause

The restart workflow had a fatal flaw:

1. User runs `stigmer server restart`
2. `handleServerRestart()` checks `IsRunning()` → returns FALSE (no PID file found)
3. **Skips the stop step entirely** (thought server wasn't running)
4. Tries to start new server on port 7234 → fails (port already in use)
5. New server process exits immediately
6. Old server keeps running (orphaned, no PID file tracking)
7. Every subsequent `stigmer apply` thinks daemon isn't running and tries to start it

### Why This Happened

Three interconnected bugs:

1. **`IsRunning()` only checked PID file** - No fallback to detect running servers
2. **`Stop()` gave up without PID file** - Couldn't kill orphaned processes
3. **`handleServerRestart()` conditionally stopped** - Only stopped if `IsRunning()` returned TRUE

This created a cascade: Missing PID file → Can't detect running server → Don't stop → Try to start on occupied port → Create orphaned process → Missing PID file (cycle repeats).

## Solution

Implemented three coordinated fixes to break the cycle:

### Fix 1: Enhanced `Stop()` - Find Orphaned Processes

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

**Problem**: `Stop()` returned error if PID file missing, leaving orphaned servers running.

**Solution**: Added fallback to find process by port using `lsof`:

```go
// Stop stigmer-server
pid, err := getPID(dataDir)
if err != nil {
    // No PID file - try to find process by port
    log.Warn().Msg("PID file not found, searching for process by port")
    pid, err = findProcessByPort(DaemonPort)
    if err != nil {
        return errors.Wrap(err, "daemon is not running")
    }
    log.Info().Int("pid", pid).Msg("Found orphaned daemon process by port")
}
// ... proceed to kill it
```

**New helper function**:

```go
func findProcessByPort(port int) (int, error) {
    cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN")
    output, err := cmd.Output()
    if err != nil {
        return 0, errors.Wrap(err, "failed to find process on port")
    }
    
    pidStr := strings.TrimSpace(string(output))
    if pidStr == "" {
        return 0, errors.New("no process found listening on port")
    }
    
    // lsof might return multiple PIDs - take first one
    lines := strings.Split(pidStr, "\n")
    pid, err := strconv.Atoi(strings.TrimSpace(lines[0]))
    if err != nil {
        return 0, errors.Wrap(err, "invalid PID from lsof output")
    }
    
    return pid, nil
}
```

**Impact**: `Stop()` can now kill orphaned servers without PID files.

### Fix 2: Improved `IsRunning()` - gRPC Fallback Detection

**File**: `client-apps/cli/internal/cli/daemon/daemon.go`

**Problem**: `IsRunning()` only checked PID file, returning FALSE for running servers without PID files.

**Solution**: Added gRPC connection fallback:

```go
func IsRunning(dataDir string) bool {
    // First try PID file check (most reliable when PID file exists)
    pid, err := getPID(dataDir)
    if err == nil {
        // PID file exists - check if process is alive
        process, err := os.FindProcess(pid)
        if err == nil {
            if process.Signal(syscall.Signal(0)) == nil {
                log.Debug().Int("pid", pid).Msg("Daemon is running (verified via PID file)")
                return true
            }
        }
        // PID file exists but process is dead - clean up stale PID file
        log.Warn().Int("pid", pid).Msg("Stale PID file found, cleaning up")
        _ = os.Remove(filepath.Join(dataDir, PIDFileName))
    }

    // Fallback: Try gRPC connection to verify server is actually running
    // This handles cases where PID file is missing but server is running
    endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    
    conn, err := grpc.DialContext(ctx, endpoint,
        grpc.WithTransportCredentials(insecure.NewCredentials()),
        grpc.WithBlock(),
    )
    if err != nil {
        log.Debug().Err(err).Msg("Daemon is not running (connection failed)")
        return false
    }
    defer conn.Close()

    // Successfully connected - stigmer-server is running (even without PID file)
    log.Warn().
        Str("endpoint", endpoint).
        Msg("Daemon is running but PID file is missing - this may cause issues with 'stigmer server stop'")
    return true
}
```

**New imports added**:
```go
"google.golang.org/grpc"
"google.golang.org/grpc/credentials/insecure"
```

**Impact**: `IsRunning()` can detect running servers even without PID files. Also cleans up stale PID files for dead processes.

### Fix 3: Unconditional Stop in `handleServerRestart()`

**File**: `client-apps/cli/cmd/stigmer/root/server.go`

**Problem**: Restart only stopped server if `IsRunning()` returned TRUE, leaving orphaned servers running.

**Solution**: Always try to stop, regardless of detection:

```go
func handleServerRestart() {
    dataDir, err := config.GetDataDir()
    if err != nil {
        cliprint.Error("Failed to determine data directory")
        clierr.Handle(err)
        return
    }

    // Always try to stop - even if IsRunning() returns false
    // This ensures we kill any orphaned servers without PID files
    cliprint.Info("Stopping server...")
    if err := daemon.Stop(dataDir); err != nil {
        // Only warn if stop fails - don't block restart
        cliprint.Warning("Could not stop server (may not be running): %v", err)
    }

    // Wait a moment for server to fully stop
    time.Sleep(1 * time.Second)

    // Start
    cliprint.Info("Starting server...")
    if err := daemon.Start(dataDir); err != nil {
        cliprint.Error("Failed to start server")
        clierr.Handle(err)
        return
    }

    cliprint.Success("Server restarted successfully")
    running, pid := daemon.GetStatus(dataDir)
    if running {
        cliprint.Info("  PID:  %d", pid)
        cliprint.Info("  Port: %d", daemon.DaemonPort)
    }
}
```

**New import added**:
```go
"time"
```

**Impact**: Restart always attempts stop (catching orphaned processes), then starts cleanly.

## Why All Three Fixes Were Needed

These fixes work together to break the orphan cycle:

1. **`IsRunning()` fix** - Detects orphaned servers → `apply` no longer tries to restart
2. **`Stop()` fix** - Kills orphaned servers → `restart` can clean up
3. **`handleServerRestart()` fix** - Always stops first → Prevents orphans from forming

Without all three, the problem would persist:
- Without Fix 1: Can't kill orphaned servers
- Without Fix 2: Can't detect orphaned servers  
- Without Fix 3: Keep creating new orphaned servers

## Testing Results

### Test Environment
- macOS (Darwin 25.2.0)
- Orphaned server running (PID 21737) on port 7234
- No PID file at `~/.stigmer/data/daemon.pid`

### Test 1: Stop Orphaned Server
```bash
stigmer server stop
# Result: ✅ Successfully stopped orphaned server
# Log: "PID file not found, searching for process by port"
# Log: "Found orphaned daemon process by port"
```

### Test 2: Start Server Cleanly
```bash
stigmer server start
# Result: ✅ Server started, PID file created at ~/.stigmer/data/daemon.pid
# PID: 39692
```

### Test 3: Status Detection
```bash
stigmer server status
# Result: ✅ Shows "✓ Running" with correct PID
```

### Test 4: Apply No Longer Restarts (Core Fix Validation)
```bash
cd ~/.stigmer/stigmer-project
stigmer apply
# Result: ✅ NO "🚀 Starting local backend daemon..." message
# Went straight to "Connecting to backend..."
# Previous behavior: Always showed "Starting daemon"
```

### Test 5: Restart Works Properly
```bash
stigmer server restart
# Result: ✅ Old PID 39692 → New PID 40207
# Server cleanly restarted with new process
```

### Test 6: Apply Still Works After Restart
```bash
stigmer apply
# Result: ✅ Still no restart message
# Deployed successfully
```

### Test 7: Orphaned Server Detection (Edge Case)
```bash
rm ~/.stigmer/data/daemon.pid
stigmer server status
# Result: ✅ Status still detects running server via gRPC
# Warning: "Daemon running but PID file missing"
```

All tests passed! ✅

## Files Changed

### Modified Files

1. **`client-apps/cli/internal/cli/daemon/daemon.go`**
   - Enhanced `Stop()` to find orphaned processes via `lsof`
   - Added `findProcessByPort()` helper function
   - Improved `IsRunning()` with gRPC fallback detection
   - Added stale PID file cleanup
   - Added imports: `google.golang.org/grpc`, `google.golang.org/grpc/credentials/insecure`

2. **`client-apps/cli/cmd/stigmer/root/server.go`**
   - Updated `handleServerRestart()` to always stop (unconditional)
   - Changed from conditional stop to always-try-stop pattern
   - Added 1-second wait between stop and start
   - Made stop errors non-fatal (warn instead of fail)
   - Added import: `time`

## Impact

### User Experience

**Before:**
```bash
$ stigmer apply
ℹ 🚀 Starting local backend daemon...  # Every time!
ℹ    This may take a moment on first run
# ... Temporal port conflicts in logs ...
```

**After:**
```bash
$ stigmer apply
ℹ Connecting to backend...  # Clean, fast
✓ ✓ Connected to backend
```

### Behavioral Changes

1. **`stigmer server stop`**
   - Before: Failed with "daemon is not running" if no PID file
   - After: Uses `lsof` to find and stop orphaned servers

2. **`stigmer server restart`**
   - Before: Conditionally stopped (created orphans)
   - After: Always stops first (prevents orphans)

3. **`stigmer server status`**
   - Before: Showed "✗ Stopped" for orphaned servers
   - After: Detects via gRPC and shows "✓ Running" with warning

4. **`stigmer apply`**
   - Before: Always showed "Starting daemon" message
   - After: Only starts if actually needed (much faster)

### Performance

- **Apply operations are faster** - No unnecessary daemon start attempts
- **Restart is more reliable** - Always stops old server first
- **Status checks are accurate** - Detects actual running state

## Technical Debt Addressed

1. ✅ Fixed PID file dependency - Now has fallback detection
2. ✅ Fixed orphaned process problem - Can find and kill them
3. ✅ Fixed restart reliability - Always stops before starting
4. ✅ Added stale PID file cleanup - Self-healing for dead processes

## Known Limitations

1. **gRPC fallback not foolproof** - If another gRPC service runs on port 7234, `IsRunning()` would incorrectly think it's stigmer-server
   - **Mitigation**: Port collision is extremely unlikely
   - **Future fix**: Implement health check endpoint with service name verification

2. **`lsof` dependency** - Required for finding orphaned processes
   - **Note**: `lsof` is built-in on macOS and most Linux systems
   - **Future consideration**: Add fallback for systems without `lsof`

## Future Improvements

1. **Health check endpoint** - Add gRPC health endpoint that returns service identity:
   ```protobuf
   message HealthResponse {
     string service_name = 1;  // "stigmer-server"
     string version = 2;
   }
   ```
   Then `IsRunning()` can verify it's actually stigmer-server, not just any gRPC service.

2. **Server self-registration** - Have stigmer-server write its own PID file on startup (defensive programming).

3. **Graceful shutdown via gRPC** - Send shutdown command instead of SIGTERM for cleaner shutdowns.

4. **Port conflict detection** - Check if port is in use before attempting to bind.

## Related Issues

This fix resolves the core issue discovered during debugging where every `stigmer apply` was attempting to restart the daemon, causing:
- Temporal "address already in use" errors (logged at apply timestamps)
- Slow apply operations (unnecessary startup overhead)
- Confusion about server state (status showed stopped when running)

## Lessons Learned

1. **PID-only detection is fragile** - Always have a fallback to actual service detection
2. **Orphaned processes are common** - Systems need to handle missing PID files gracefully
3. **Restart must be unconditional** - Detection can fail, so always try to stop
4. **Comprehensive testing matters** - The issue only surfaced through real-world usage patterns

## Dependencies

- Requires `lsof` command (standard on macOS/Linux)
- Requires gRPC connection capability (already in use)
- No new external dependencies added

## Migration Notes

No migration needed - fixes are backward compatible. Existing PID files continue to work. Orphaned servers will be automatically detected and can be stopped properly.

---

**Verification**: All fixes tested and validated with comprehensive test scenarios. Ready for production use.
