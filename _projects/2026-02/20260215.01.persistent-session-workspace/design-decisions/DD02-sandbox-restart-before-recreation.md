# DD02: Sandbox Restart/Recovery Before Recreation

**Date**: 2026-02-15
**Status**: Approved
**Decision Maker**: Developer (Suresh)

## Context

Even with persistent volumes for files, the sandbox itself holds valuable runtime state: installed packages (`pip install`, `apt install`), compiled tools, environment modifications. Recreating a sandbox loses this state.

Daytona sandboxes have lifecycle states: started, stopped, archived, error. Stopped and archived sandboxes can be restarted/restored, preserving all runtime state.

## Decision

Before creating a new sandbox, attempt to restart/recover the existing one. Only create a new sandbox as a last resort.

## Priority Chain

```
1. sandbox.state == "started"   → reuse directly (fastest)
2. sandbox.state == "stopped"   → sandbox.start() (~5-10s, packages preserved)
3. sandbox.state == "archived"  → restore + start (~30-60s, packages preserved)
4. sandbox.state == "error" && recoverable → sandbox.recover()
5. sandbox gone or unrecoverable → create new + mount volume (files preserved, packages lost)
```

## Also

Disable `auto_delete_interval` on sandbox creation (`sandbox.set_auto_delete_interval(-1)`) to prevent Daytona from deleting sandboxes behind our back. We manage sandbox lifecycle ourselves.

## Consequences

- Runtime package installations survive across most resume scenarios
- Only truly destroyed sandboxes lose packages
- Longer resume time for archived sandboxes (~30-60s) but better than losing state
- Need to handle each sandbox state gracefully
