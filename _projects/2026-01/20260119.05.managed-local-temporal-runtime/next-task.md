# Next Task: Managed Local Temporal Runtime

**Project**: Managed Local Temporal Runtime  
**Location**: `_projects/2026-01/20260119.05.managed-local-temporal-runtime/`  
**Status**: 🚧 Ready to Start

## Quick Context

Implement automatic Temporal binary management to eliminate Docker dependency. Currently:
- ❌ Users must install Docker manually
- ❌ Users must run Temporal container
- ❌ Heavy setup creates friction

Goal:
- ✅ Auto-download Temporal CLI on first run
- ✅ Auto-start as managed subprocess
- ✅ Zero Docker dependency
- ✅ Support external Temporal via flag/env
- ✅ Cascading config: Flag > Env > Managed local

## Current Task

**Task 1: Analyze Current Temporal Connection**

Understand how the daemon currently connects to Temporal and where the host/port is configured.

**Steps**:
1. Find where Temporal client is created in daemon code
2. Identify current host/port configuration
3. Check if there's any existing binary management code
4. Document current startup sequence
5. Identify where to hook in the "managed binary" logic

## Quick Commands

```bash
# Find Temporal client usage in daemon
rg "NewClient" backend/stigmer-daemon/ --type go

# Find Temporal imports
rg "go.temporal.io/sdk" backend/stigmer-daemon/ --type go

# Look for existing supervisor code
find backend/stigmer-daemon -name "*supervisor*" -type f

# Check for existing process management
rg "exec.Command" backend/stigmer-daemon/ --type go
```

## Key Questions to Answer

1. Where is the Temporal client created?
2. How is the host/port currently configured? (hardcoded? env var?)
3. Is there already a supervisor pattern for managing subprocesses?
4. Where does daemon startup sequence happen?
5. Any existing binary download/management code?

## Expected Outputs

- File: `notes.md` - Document findings
- Understanding of integration points
- List of files that need changes

## Related Files

- ADR Doc: `_cursor/adr-doc` (ADR 018)
- Tasks: `tasks.md`
- Notes: `notes.md`

## After This Task

Move to **Task 2: Design Binary Download Strategy**

---

**Drag this file into chat to resume!**
