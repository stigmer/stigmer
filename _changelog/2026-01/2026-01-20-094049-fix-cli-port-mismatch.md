# Fix CLI Port Mismatch - Connect to Server on Port 7234

**Date**: 2026-01-20
**Type**: Bug Fix
**Scope**: CLI Backend Client
**Impact**: Critical - CLI couldn't connect to stigmer-server

## Problem

The CLI was unable to connect to stigmer-server, failing with:
```
Error: Cannot connect to stigmer-server

Is the server running?
  stigmer server
```

**Root cause**: Port mismatch between server and client.

- **Server** was changed to use port **7234** (Temporal + 1) in recent daemon architecture update
- **CLI client** was still hardcoded to connect to port **50051** (old default)

Result: Server listening on 7234, client trying to connect to 50051 → connection refused.

## Investigation

Traced the connection flow:

1. User runs `stigmer apply`
2. CLI loads backend config (local mode)
3. Backend client defaults to `localhost:50051` if no endpoint configured
4. Connection attempt fails (nothing listening on 50051)
5. Server is actually running on port 7234

**Files with port mismatch**:
- `client-apps/cli/internal/cli/backend/client.go:71` - Hardcoded `localhost:50051`
- `client-apps/cli/cmd/stigmer/root/backend.go:94` - Hardcoded `localhost:50051` in backend config

**Evidence of port change**:
- `client-apps/cli/internal/cli/daemon/daemon.go:24` - `DaemonPort = 7234`
- `backend/services/stigmer-server/pkg/config/config.go:21` - `GRPCPort: 7234`
- `_changelog/2026-01/2026-01-20-complete-daemon-architecture.md` - Documents port 7234 adoption

## Solution

Updated CLI backend client to use port **7234** to match server:

### 1. Backend Client Default Endpoint

**File**: `client-apps/cli/internal/cli/backend/client.go`

```go
// Before:
endpoint = "localhost:50051" // default from ADR 011

// After:
endpoint = "localhost:7234" // default port (Temporal + 1)
```

**Changes**:
- Line 71: Updated default endpoint from 50051 to 7234
- Lines 20-24: Updated comments documenting port change

### 2. Backend Configuration Command

**File**: `client-apps/cli/cmd/stigmer/root/backend.go`

```go
// Before:
Endpoint: "localhost:50051",

// After:
Endpoint: "localhost:7234",
```

**Changes**:
- Line 94: Updated default endpoint in LocalBackendConfig from 50051 to 7234
- Line 19: Updated help text documentation from 50051 to 7234

## Impact

**Before**: CLI could not connect to server (broken)
```
stigmer apply
✓ Loaded Stigmer.yaml
ℹ Connecting to backend...
Error: Cannot connect to stigmer-server
```

**After**: CLI successfully connects
```
stigmer apply
✓ Loaded Stigmer.yaml
ℹ Connecting to backend...
✓ Connected to backend
ℹ Deploying agent 1/1: pr-reviewer
```

**User impact**:
- ✅ Local mode now works (CLI → server connection restored)
- ✅ No configuration changes required from users
- ✅ Existing users with custom endpoints unaffected (only default changed)

## Testing

**Manual verification**:
1. Start server: `stigmer server` (listening on 7234)
2. Run apply: `stigmer apply`
3. Observe: Connection succeeds, agent deployment proceeds

**Expected behavior**:
- Backend client defaults to `localhost:7234` if no endpoint configured
- Connection succeeds when server is running on port 7234
- Error message unchanged if server not running

## Why This Happened

**Context**: Recent daemon architecture consolidation (2026-01-20) standardized on port 7234.

**What was updated**:
- ✅ Server config (port 7234)
- ✅ Daemon launcher (port 7234)
- ✅ Documentation (references port 7234)
- ❌ CLI backend client (still using 50051) ← **MISSED**

**Lesson**: When changing ports, search codebase for all hardcoded references:
```bash
# What should have been done:
rg "50051" --type go
rg "localhost:50051"
```

This would have caught the CLI client hardcoded defaults.

## Related Files

**Updated**:
- `client-apps/cli/internal/cli/backend/client.go` - Backend client default endpoint
- `client-apps/cli/cmd/stigmer/root/backend.go` - Backend config command

**Related (already correct)**:
- `client-apps/cli/internal/cli/daemon/daemon.go` - Daemon port 7234 ✅
- `backend/services/stigmer-server/pkg/config/config.go` - Server port 7234 ✅

## Migration Notes

**No user action required** - This is a bug fix that restores expected behavior.

Users who manually configured endpoints (via env var or config file) are unaffected.

**If users have issues**:
1. Check server is running: `stigmer server status`
2. Verify server port: Should show `localhost:7234`
3. Check backend config: `stigmer backend status`
4. If custom endpoint set: Ensure it's `localhost:7234`

## References

- **Port change context**: `_changelog/2026-01/2026-01-20-complete-daemon-architecture.md`
- **Daemon implementation**: `client-apps/cli/internal/cli/daemon/daemon.go`
- **Server config**: `backend/services/stigmer-server/pkg/config/config.go`
- **Error report**: `_cursor/error.md`
