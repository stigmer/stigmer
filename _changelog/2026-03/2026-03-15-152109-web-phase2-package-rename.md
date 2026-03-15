# Web Phase 2: Domain Package Rename (`@stigmer/react-ui` → `@stigmer/agent-execution-ui`)

**Date**: March 15, 2026

## Summary

Renamed the `@stigmer/react-ui` domain package to `@stigmer/agent-execution-ui` to align the package name with Stigmer's ubiquitous language and bounded context model. The rename is fully mechanical — zero functional changes — but establishes a precise naming convention that scales as the platform grows.

## Problem Statement

The `@stigmer/react-ui` package name was a placeholder that communicated nothing about its domain scope. The package contains exclusively AgentExecution-related components (execution streaming, tool calls, HITL approvals, sub-agent delegation), but the name suggested it could be anything.

### Pain Points

- **Ambiguous scope**: "react-ui" gives no signal about what domain the package serves
- **Collision risk**: As future domain packages are added (workflow execution, session management, catalog), a generic name creates confusion about where new code belongs
- **Domain language violation**: The Architect mandate requires every name to match the ubiquitous language — "AgentExecution" is the precise domain term

## Solution

Renamed to `@stigmer/agent-execution-ui`, following a naming convention that maps directly to the API bounded contexts (`agentic/agentexecution/v1/`). This leaves clean namespace room for future packages:

- `@stigmer/workflow-execution-ui` — DAG visualization (different UI paradigm)
- `@stigmer/session-ui` — session management (Phase 7)
- `@stigmer/catalog-ui` — resource browsing (Phase 7)

## Implementation Details

- Directory renamed via `git mv` (preserves file history)
- Updated `package.json` name and repository.directory fields
- Updated all 4 consumer import sites in the web console
- Updated `next.config.ts` transpilePackages, root build/clean scripts, and `_libs/README.md`
- Updated package README with new import paths
- Added `**/dist/` to `.prettierignore` (pre-existing oversight from Phase 1 — build artifacts were not excluded from format checking)
- Recorded design decision with rationale and alternatives considered

### Files Changed

- 14 files modified + 1 new file (design decision doc)
- 25 files renamed (directory move)
- All changes are mechanical — no logic, component, or API changes

## Benefits

- Package name now communicates its exact domain scope to any developer
- Import paths (`@stigmer/agent-execution-ui/execution`) read as self-documenting code
- Clean namespace convention for future domain packages
- Design decision documented for future reference

## Impact

- **Internal**: All imports updated — build, lint, and format:check pass cleanly
- **External consumers**: Package not yet published to npm — no breaking change for external users
- **Future work**: Naming convention established for Phase 7 domain library extraction

## Related Work

- Part of the [Web Architecture & UX Alignment](_projects/2026-03/20260315.02.web-architecture-alignment/) project (Phase 2, Task T03)
- Follows [Phase 1: Dead Code & Tooling](_changelog/2026-03/2026-03-15-150158-web-phase1-dead-code-tooling.md) which established the Prettier + ESLint baseline
- Next: T04 — Visual Identity & Theme System

---

**Status**: Production Ready
