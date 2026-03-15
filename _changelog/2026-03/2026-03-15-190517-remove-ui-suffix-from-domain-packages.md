# Remove `-ui` Suffix from Domain Packages

**Date**: March 15, 2026

## Summary

Renamed all five domain packages under `client-apps/web/_libs/domain/` to drop the redundant `-ui` suffix from directory names and npm package names. The packages now align with the domain vocabulary (e.g. `@stigmer/agent`, `@stigmer/session`) rather than carrying a transport-layer label that adds no meaningful distinction in a UI-only package layer.

## Problem Statement

The domain packages were named with a `-ui` suffix (`@stigmer/agent-ui`, `@stigmer/agent-execution-ui`, `@stigmer/mcp-server-ui`, `@stigmer/session-ui`, `@stigmer/skill-ui`). Since these packages already live under `_libs/domain/` -- a layer that is inherently UI-facing -- the suffix was redundant and created unnecessary verbosity in every import statement across the codebase.

### Pain Points

- Import paths like `@stigmer/agent-execution-ui` are long and add cognitive noise
- The `-ui` suffix implies a distinction from a non-UI counterpart that does not exist
- Violates the Ubiquitous Language principle: the domain concepts are Agent, Session, Skill -- not "Agent UI"
- Every new consumer file requires typing the suffix, compounding across the codebase

## Solution

Renamed all five packages by stripping the `-ui` suffix, then updated all references across the codebase.

| Before | After |
|---|---|
| `@stigmer/agent-execution-ui` | `@stigmer/agent-execution` |
| `@stigmer/agent-ui` | `@stigmer/agent` |
| `@stigmer/mcp-server-ui` | `@stigmer/mcp-server` |
| `@stigmer/session-ui` | `@stigmer/session` |
| `@stigmer/skill-ui` | `@stigmer/skill` |

## Implementation Details

- Renamed 5 directories under `client-apps/web/_libs/domain/`
- Updated `name` and `repository.directory` fields in all 5 `package.json` files
- Updated `transpilePackages` in `next.config.ts`
- Updated 19 import statements across consumer files in `src/`
- Updated documentation in `_libs/README.md` and `agent-execution/README.md`
- Cleaned up stale `dist/` and `tsconfig.tsbuildinfo` build artifacts
- Reinstalled npm workspaces to re-resolve symlinks
- Verified TypeScript compilation passes with zero errors

## Benefits

- Cleaner, more concise import paths (e.g. `from "@stigmer/agent"` vs `from "@stigmer/agent-ui"`)
- Package names now match the domain vocabulary exactly
- Reduced cognitive overhead when writing new consumer code
- Better alignment with the Architect role's mandate on Ubiquitous Language

## Impact

- All existing import statements updated -- no breaking changes for the web console
- npm workspace resolution unaffected (root `package.json` uses a glob pattern)
- No tsconfig path alias changes needed

---

**Status**: Production Ready
