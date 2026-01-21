# Issue: Makefile Building Obsolete stigmer-server Binary

**Date**: 2026-01-21  
**Status**: ✅ Fixed  
**Severity**: Medium (confusing developer experience)

## Problem

After implementing the BusyBox pattern refactoring (Phase 2.5), the Makefile was still building `stigmer-server` as a standalone binary in the `release-local` target, even though:

1. stigmer-server code is now compiled INTO the CLI binary
2. The daemon spawns the server via `stigmer internal-server` (hidden command)
3. There's no need for a separate stigmer-server binary anymore

This caused confusion during local development:
```bash
$ make release-local-full

Step 2: Building fresh binaries...
✓ CLI built: bin/stigmer
✓ Server built: bin/stigmer-server  ← ❌ OBSOLETE!
```

## Root Cause

The Makefile was not updated when the BusyBox pattern was implemented. It was still following the old architecture:

**Old Architecture** (Before Phase 2.5):
```
stigmer CLI       → bin/stigmer (standalone)
stigmer-server    → bin/stigmer-server (standalone)
workflow-runner   → bin/workflow-runner (standalone)
agent-runner      → poetry/script (Python environment)
```

**New Architecture** (After Phase 2.5):
```
stigmer CLI       → bin/stigmer (contains server + workflow-runner)
  ├─ internal-server          (hidden command, runs stigmer-server code)
  ├─ internal-workflow-runner (hidden command, runs workflow-runner code)
  └─ embedded agent-runner binary (PyInstaller, extracted to ~/.stigmer/bin/)
```

## Files Affected

1. **Makefile** `release-local` target - Still building stigmer-server
2. **Makefile** `build-backend` target - Still building stigmer-server and workflow-runner worker

## Solution

### 1. Fixed `release-local` Target

**Before:**
```makefile
@echo "Step 2: Building fresh binaries..."
@cd client-apps/cli && go build -o ../../bin/stigmer .
@echo "✓ CLI built: bin/stigmer"
@go build -o bin/stigmer-server ./backend/services/stigmer-server/cmd/server
@echo "✓ Server built: bin/stigmer-server"  ← REMOVED
```

**After:**
```makefile
@echo "Step 2: Building fresh binaries..."
@cd client-apps/cli && go build -o ../../bin/stigmer .
@echo "✓ CLI built: bin/stigmer"
# stigmer-server is now part of CLI (BusyBox pattern)
```

### 2. Updated `build-backend` Target

**Before:**
```makefile
@echo "1/4 Building stigmer-server..."
go build -o bin/stigmer-server ./backend/services/stigmer-server/cmd/server
@echo "✓ Built: bin/stigmer-server"
@echo "2/4 Building workflow-runner worker..."
go build -o bin/workflow-runner ./backend/services/workflow-runner/cmd/worker
@echo "✓ Built: bin/workflow-runner"
```

**After:**
```makefile
@echo "Note: stigmer-server and workflow-runner are now part of the CLI (BusyBox pattern)"
@echo "      Use 'stigmer internal-server' and 'stigmer internal-workflow-runner' instead"
@echo ""
@echo "1/2 Building workflow-runner gRPC server..."
go build -o bin/workflow-runner-grpc ./backend/services/workflow-runner/cmd/grpc-server
@echo "✓ Built: bin/workflow-runner-grpc"
```

**Note**: We kept `workflow-runner-grpc` because it's a separate gRPC server mode used for testing/development, not part of the standard daemon workflow.

## Verification

After the fix, running `make release-local-full` now correctly shows:

```bash
Step 1: Building agent-runner binary...
✓ Installed: ~/.stigmer/bin/agent-runner

Step 2: Building and installing CLI...
Step 1: Removing old binaries...
✓ Old binaries removed

Step 2: Building fresh binaries...
✓ CLI built: bin/stigmer

Step 3: Installing to ~/bin...
✓ Installed: ~/bin/stigmer

✓ Complete Local Release Ready!

Components installed:
  • CLI: ~/bin/stigmer
  • Agent Runner: ~/.stigmer/bin/agent-runner
```

No more confusing "Server built: bin/stigmer-server" message.

## Impact

**Before Fix:**
- Developers saw "Server built" in output, causing confusion
- Unnecessary stigmer-server binary was being created
- Inconsistent with the documented BusyBox architecture
- Wasted build time compiling unused binary

**After Fix:**
- Clear, accurate build output
- Only builds what's actually needed (CLI + agent-runner)
- Consistent with BusyBox pattern documentation
- Faster builds (one less binary to compile)

## Related Documentation

- Project README: Phase 2.5 BusyBox Pattern Refactoring
- `tasks/IMPLEMENTATION_SUMMARY.md` - Architecture diagrams
- `client-apps/cli/cmd/stigmer/root/internal.go` - Hidden commands implementation
- `client-apps/cli/internal/cli/daemon/daemon.go` - Daemon spawn logic

## Lessons Learned

1. **Update Makefiles immediately** when refactoring architecture
2. **Run full local build** after major refactoring to catch these issues
3. **Build output messages matter** - they're documentation for developers
4. **Grep for binary names** when removing components to find all references

## Changes Made

```
✅ Makefile - release-local target updated
✅ Makefile - build-backend target updated
✅ Removed obsolete stigmer-server build step
✅ Removed obsolete workflow-runner worker build step
✅ Added clarifying note about BusyBox pattern
✅ Cleaned up installation steps
```

## Testing

```bash
# Clean slate
rm -rf ~/bin/stigmer
rm -rf ~/.stigmer/bin/agent-runner

# Full build
make release-local-full

# Verify only correct binaries exist
ls -lh ~/bin/stigmer                 # ✅ Should exist
ls -lh ~/.stigmer/bin/agent-runner   # ✅ Should exist
ls -lh ~/bin/stigmer-server          # ❌ Should NOT exist

# Verify daemon works with BusyBox pattern
stigmer server
# Should start all services using internal commands
```

---

**Status**: Issue fixed, Makefile now reflects BusyBox architecture correctly.
