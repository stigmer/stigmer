# Fix Dynamic Route Navigation and Promote Embeddable Components

**Date**: March 15, 2026

## Summary

Fixed a critical navigation bug where clicking agent cards (and all dynamic route detail pages) did nothing, and promoted `AgentPicker`, `AgentSessionHistory`, and `SessionCard` from console-only components to embeddable domain-package components in `@stigmer/agent` and `@stigmer/session`.

## Problem Statement

Two distinct issues were blocking the platform's core user journeys and embeddability goals.

### Pain Points

- Clicking agent cards on the `/agents` page produced no navigation, no error, and no feedback -- violating Nielsen's Heuristic #1 (Visibility of System Status)
- The same bug affected all four dynamic route pages: agents, sessions, skills, and mcp-servers
- `AgentPicker` and `AgentSessionHistory` were locked in the console layer, making them unavailable to platform builders who want to embed Stigmer's agent experience
- `SessionCard` hardcoded Next.js `<Link>` routing, preventing use outside the console

## Solution

### Navigation Fix

The root cause was a mismatch between Next.js App Router's `output: "export"` static build and the Go SPA handler. All dynamic routes use `generateStaticParams` with a `__placeholder__` value, meaning only `agents/__placeholder__.html` and `agents/__placeholder__.txt` (RSC payload) exist in the build output. When the client-side router requested `/agents/abc123.txt`, the SPA handler returned `index.html` instead, causing the RSC parser to fail silently.

The fix adds a `resolveDynamicRoute` step to the Go `spaHandler` that rewrites dynamic segment paths to their `__placeholder__` equivalents before falling back to `index.html`.

### Component Promotion

Moved interactive components to domain packages following the platform's three-layer architecture (services -> hooks -> components), making them framework-agnostic and embeddable:

- `AgentPicker` -> `@stigmer/agent` (accepts `org` prop instead of console context)
- `useAgentSearch` -> `@stigmer/agent` (accepts `org` parameter)
- `SessionCard` -> `@stigmer/session` (accepts `onNavigate` callback instead of hardcoded routing)
- `AgentSessionHistory` -> `@stigmer/session` (accepts `onSessionSelect` callback)
- `useAgentSessionList` -> `@stigmer/session` (standalone, no `@tanstack/react-query` dependency)

## Implementation Details

### SPA Handler (`handler.go`)

- Three-step resolution: direct file lookup -> `resolveDynamicRoute` -> SPA fallback
- `resolveDynamicRoute` handles both RSC payloads (`.txt` files) and full page loads (extensionless paths mapped to `.html`)
- Hashed assets get `Cache-Control: public, max-age=31536000, immutable`; rewritten routes get `Cache-Control: no-cache`
- `isFile` helper differentiates files from directories in the embedded filesystem
- Comprehensive test suite (`handler_test.go`) covers all resolution paths

### Domain Package Changes

- `@stigmer/agent`: New exports `AgentPicker`, `useAgentSearch`, `SelectedAgent`, `AgentSearchResult`
- `@stigmer/session`: New exports `SessionCard`, `AgentSessionHistory`, `useAgentSessionList`, plus their type interfaces
- `@stigmer/session/package.json`: Added `@stigmer/theme` dependency and `lucide-react` peer dependency

### Console Layer Changes

- `AgentDetailPage`: Imports `AgentSessionHistory` from `@stigmer/session`, provides `onSessionSelect` via `useRouter`
- `Run page`: Imports `AgentPicker` from `@stigmer/agent`, passes `org` from `useActiveOrgSlug()`
- `SessionCard` (console): Thin wrapper around domain `SessionCard`, providing `onNavigate` via `useRouter`
- Deleted four console-only files that are now superseded by domain equivalents

## Benefits

- All four dynamic route detail pages now work correctly via both client-side navigation and direct URL access
- Platform builders can embed `AgentPicker` and `AgentSessionHistory` in their own apps with minimal wiring (pass `org`, provide navigation callbacks)
- Domain components have zero dependency on Next.js, console contexts, or `@tanstack/react-query`
- Console components are thin wrappers, reducing console-layer maintenance surface
- Test coverage for the SPA handler's most critical routing logic

## Impact

- **End users**: Agent cards (and all resource cards) are now clickable and navigate correctly
- **Platform builders**: Three new embeddable components available from `@stigmer/agent` and `@stigmer/session`
- **Console maintainers**: Four fewer console-specific components to maintain; routing logic centralized in thin wrappers

## Related Work

- Follows the domain package architecture established in `refactor(web): remove -ui suffix from domain package names`
- Complements the `@stigmer/agent-execution` domain package pattern
- Addresses the embeddability mandate from `_roles/004_web_ux_ui.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
