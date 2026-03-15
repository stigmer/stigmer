# Web _libs Workspace Scaffolding

**Date**: March 15, 2026

## Summary

Established the `_libs` workspace package pattern in the Stigmer web console, creating a three-layer architecture (infra, ui, domain) for reusable, publishable React component libraries. This is the foundation for extracting existing execution components into `@stigmer/react-ui` so platform owners can embed agent execution UI in their applications.

## Problem Statement

Stigmer's web console has working execution streaming components (ExecutionStream, ToolCallCard, ApprovalControls, etc.) built as local source files. Platform owners who want to embed agent execution UI in their apps must build everything from scratch. There is no package boundary separating reusable components from console-specific shell code.

### Pain Points

- No separation between reusable components and console-specific code
- External consumers cannot install Stigmer UI components from npm
- No enforced architectural layering in the frontend codebase
- Dependency direction between components is implicit, not enforced

## Solution

Adopted Planton's proven `_libs` workspace pattern — three-layer architecture with strict one-way dependency flow, IoC bridge pattern for decoupling, and source-only packages consumed by Next.js via `transpilePackages`. Adapted the pattern for Stigmer's toolchain: npm (not yarn), ESLint flat config, Tailwind v4, strict TypeScript.

## Implementation Details

Created the directory structure and workspace configuration:

- **`_libs/infra/rpc-client/`** — `@stigmer/rpc-client` (Connect-RPC transport, auth, service clients)
- **`_libs/ui/theme/`** — `@stigmer/theme` (CSS tokens, `cn()` utility, shared theme)
- **`_libs/domain/react-ui/`** — `@stigmer/react-ui` (execution components, hooks, providers)

Key configuration:

- `tsconfig.base.json` with `strict: true` (deviated from Planton's lax `strict: false`)
- Root `package.json` workspace globs for automatic package discovery
- `next.config.ts` `transpilePackages` for SWC compilation of source-only packages
- ESLint flat config `no-restricted-imports` rule forbidding `@/` imports in `_libs/`

Architectural decisions documented:

- Directory naming matches package name (`domain/react-ui/`, not `domain/execution/`)
- npm `"*"` dependencies (not yarn's `workspace:*` protocol)
- Single ESLint flat config (not a separate `.eslintrc.yml` for _libs)
- No premature build artifacts (`declaration`/`sourceMap` deferred to publishing phase)

## Benefits

- Clear architectural layering enforced by ESLint and dependency direction
- New packages in any layer are auto-discovered by workspace globs
- Source-only development: zero build step during development, instant hot reload
- Foundation for npm publishing (T06) without changing the development workflow
- "Can a new engineer understand this in 5 minutes" README documenting all conventions

## Impact

- **Frontend team**: Clear patterns for where reusable code lives vs console-specific code
- **External consumers**: Path to `npm install @stigmer/react-ui` (when T04 + T06 complete)
- **Architecture**: Enforced dependency direction prevents the console from becoming a monolith

## Related Work

- Prior research: `20260314.04.web-ui-assistant-ui-integration` — evaluated AG-UI, CopilotKit, assistant-ui; concluded to package existing components first
- Design decision: `DD-001` — adopt _libs pattern, no new protocols
- Reference: Planton `_libs` pattern at `plantonhq/planton/client-apps/web/_libs/`
- Next: T02 (@stigmer/rpc-client), T03 (@stigmer/theme), T04 (@stigmer/react-ui)

---

**Status**: Production Ready
**Timeline**: T01 of 6-task project
