# Remove `stigmer server db-dump` Command and Hide Debug URL

**Date**: 2026-01-21 21:15:10  
**Type**: CLI cleanup, UX improvement  
**Scope**: `client-apps/cli`

## Summary

Removed the `stigmer server db-dump` command and hidden the BadgerDB debug URL from user-facing CLI output. The debug endpoint at `http://localhost:8234/debug/db` remains functional but is now developer-only, not advertised to users.

## Problem

The `stigmer server db-dump` command was problematic:

1. **Readonly access errors**: Command attempted to open BadgerDB in readonly mode, causing errors when server was running:
   ```
   ❌ Failed to open BadgerDB: Cannot find directory "/Users/suresh/.stigmer/data/badger" for read-only open
   
   Common causes:
     • Server is still running (BadgerDB file is locked)
     • Another process is using the database
   ```

2. **Incorrect database path**: The command was looking for `/Users/suresh/.stigmer/data/badger` but actual BadgerDB data is at `/Users/suresh/.stigmer/stigmer.db`

3. **Confusing UX**: Users had to stop server, run db-dump, restart server - complex workflow for debugging

4. **Redundant functionality**: The web-based BadgerDB Inspector at `localhost:8234/debug/db` provides better UX with live updates, no readonly issues, and works while server is running

## Solution

### 1. Removed `db-dump` Command

**Deleted**:
- `client-apps/cli/cmd/stigmer/root/server_db_dump.go` - Entire command implementation (150+ lines)

**Modified**:
- `client-apps/cli/cmd/stigmer/root/server.go`:
  - Removed command registration: `cmd.AddCommand(newServerDbDumpCommand())`
  - Command no longer appears in `stigmer server --help`

**Result**:
```bash
# Before
$ stigmer server --help
Available Commands:
  db-dump     Dump BadgerDB contents (server must be stopped)
  logs        View Stigmer server logs
  restart     Restart the Stigmer server
  status      Show server status
  stop        Stop the Stigmer server

# After
$ stigmer server --help
Available Commands:
  logs        View Stigmer server logs
  restart     Restart the Stigmer server
  status      Show server status
  stop        Stop the Stigmer server
```

### 2. Hidden Debug URL from Users

The BadgerDB Inspector web UI remains functional at `http://localhost:8234/debug/db` but is no longer advertised to users.

**Changes to `server.go`**:

**In `handleServerStart()` success message**:
```go
// Before
cliprint.PrintInfo("Web UIs:")
cliprint.PrintInfo("  Temporal:  http://localhost:8233")
cliprint.PrintInfo("  Stigmer:   http://localhost:8234/debug/db")

// After
cliprint.PrintInfo("Web UI:")
cliprint.PrintInfo("  Temporal:  http://localhost:8233")
```

**In `handleServerStatus()` output**:
```go
// Before
cliprint.PrintInfo("Web UIs:")
cliprint.PrintInfo("  Temporal:  http://localhost:8233")
cliprint.PrintInfo("  Stigmer:   http://localhost:8234/debug/db")

// After
cliprint.PrintInfo("Web UI:")
cliprint.PrintInfo("  Temporal:  http://localhost:8233")
```

**Result**:
```bash
# Server start output (after)
✓ Ready! Stigmer server is running
ℹ   PID:  74150
ℹ   Port: 7234
ℹ   Data: /Users/suresh/.stigmer/data
ℹ 
ℹ Web UI:
ℹ   Temporal:  http://localhost:8233

# Server status output (after)
Stigmer Server Status:
─────────────────────────────────────
ℹ   Status: ✓ Running
ℹ   PID:    74150
ℹ   Port:   7234
ℹ   Data:   /Users/suresh/.stigmer/data
ℹ 
ℹ Web UI:
ℹ   Temporal:  http://localhost:8233
```

### 3. Debug Endpoint Remains Functional

**What still works**:
- Debug HTTP server at `localhost:8234` (started by `stigmer-server`)
- BadgerDB Inspector at `http://localhost:8234/debug/db`
- All debug endpoints (`/debug/db?filter=agent`, `/debug/db?filter=all`, etc.)
- Live view of BadgerDB contents while server is running

**Philosophy**:
- Debug endpoint is purely for **developers debugging Stigmer internals**
- Not a user-facing feature - users don't need to inspect BadgerDB
- Hacky but useful tool for development
- No need to advertise or document it for users

## Technical Details

### BadgerDB Data Location

The actual BadgerDB data directory:
```bash
~/.stigmer/stigmer.db/
├── 000001.vlog
├── 00001.mem
├── DISCARD
├── KEYREGISTRY
├── LOCK
├── MANIFEST
└── *.sst (SST files)
```

**Note**: Despite the `.db` suffix, `stigmer.db` is a **directory** containing BadgerDB files.

### Why the db-dump Command Failed

1. **Wrong path**: Command looked for `~/.stigmer/data/badger` but data is at `~/.stigmer/stigmer.db`
2. **Readonly mode**: BadgerDB locks files when server is running; readonly mode still requires lock access
3. **File locking**: Even readonly access fails when server has active write lock

### Debug Server Implementation

The debug HTTP server remains in `backend/services/stigmer-server/pkg/server/server.go`:

```go
// Start debug HTTP server (for inspecting BadgerDB in browser)
go startDebugServer(8234, store)
```

This starts automatically with `stigmer-server` and provides live BadgerDB inspection.

## Impact

**User Experience**:
- ✅ Simplified CLI (removed confusing command)
- ✅ Cleaner help output
- ✅ No more readonly access errors
- ✅ Reduced cognitive load (one less command to understand)

**Developer Experience**:
- ✅ Debug endpoint still available for development
- ✅ Live BadgerDB inspection via browser
- ✅ No need to stop server to inspect data

**Removed Complexity**:
- ❌ No more readonly access error messages
- ❌ No more "stop server → dump → restart" workflow
- ❌ No more incorrect database path issues

## Alternative Solutions Considered

### Option 1: Fix the db-dump Command
- **Pros**: Keeps CLI-based inspection
- **Cons**: Complex (readonly access, path correction, lock handling)
- **Decision**: Rejected - web UI is better UX

### Option 2: Remove Debug Endpoint Entirely
- **Pros**: Cleaner codebase
- **Cons**: Lose useful development tool
- **Decision**: Rejected - keep for developers

### Option 3: Document Debug URL for Users
- **Pros**: Transparent about all features
- **Cons**: Exposes internal tool, confuses users
- **Decision**: Rejected - keep developer-only

**Chosen**: Remove db-dump, hide URL, keep debug endpoint functional

## Files Changed

```
client-apps/cli/cmd/stigmer/root/
├── server_db_dump.go         ← DELETED (150+ lines)
└── server.go                  ← MODIFIED (removed command + hidden URLs)
```

## Migration Guide

**For users**:
- If you used `stigmer server db-dump`: Command no longer exists
- No migration needed - feature removed intentionally
- If you need to inspect data: Contact developers for debug URL

**For developers**:
- Debug endpoint still at `http://localhost:8234/debug/db`
- Access via browser while server is running
- Filters: `?filter=agent`, `?filter=workflow`, `?filter=all`

## Future Considerations

### Potential Enhancements

1. **Enhanced Debug Endpoint**:
   - Add search/filter UI
   - Add export functionality
   - Add data manipulation (delete, update)

2. **Developer Documentation**:
   - Document debug endpoints in developer guide
   - Add troubleshooting section
   - Include screenshots of BadgerDB Inspector

3. **Authentication**:
   - Add basic auth to debug endpoint
   - Prevent accidental public exposure
   - Still localhost-only by design

**Note**: These are future considerations, not current priorities.

## Verification

**CLI cleanup verified**:
```bash
$ stigmer server --help
# db-dump command not listed ✓

$ stigmer server
# No debug URL shown in output ✓

$ stigmer server status  
# No debug URL shown in status ✓
```

**Debug endpoint verified**:
```bash
$ curl http://localhost:8234/debug/db?filter=agent
# Returns agent data (works) ✓
```

## Related Work

**Previous issues**:
- BadgerDB data path confusion (`data/badger` vs `stigmer.db`)
- Readonly access errors when server running
- Users expecting CLI-based database inspection

**This change addresses**:
- Removes problematic CLI command
- Simplifies user-facing surface area
- Keeps useful developer tool hidden

## Key Decisions

1. **Remove vs Fix**: Chose to remove entirely rather than fix readonly access issues
2. **Keep Debug Endpoint**: Valuable for development, just hide from users
3. **No Documentation**: Debug endpoint is intentionally undocumented (developer-only)

## Conclusion

This cleanup removes a problematic user-facing command while preserving useful developer tooling. The BadgerDB Inspector web UI is superior for debugging (live view, no readonly issues, works while server running) and keeping it hidden maintains clean user-facing documentation while empowering developers.

**Before**: Confusing CLI command with readonly errors  
**After**: Clean CLI + hidden but functional debug endpoint

**Result**: Better UX for users, preserved functionality for developers.
