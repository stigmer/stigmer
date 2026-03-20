# Draft Session Navigation Helper (T03.1)

**Date**: March 20, 2026

## Summary

Added a Console-level utility module that maps Library "Create New" resource types to pre-filled session URLs, establishing the URL contract for the Phase 3 "Create New" draft flow. This is the foundation that SessionLauncher pre-fill (T03.2) and Library button wiring (T03.3) will consume.

## Problem Statement

All six "Create New" buttons across the Library (landing page + 3 list pages) navigate to `/` with no context. The user lands on the generic SessionLauncher and has to manually discover and select the correct system agent (e.g., `stigmer/agent-creator`). This adds unnecessary friction to the resource creation flow.

### Pain Points

- No connection between Library "Create" intent and SessionLauncher agent selection
- User must know which system agent corresponds to which resource type
- No URL-based deep linking for draft sessions

## Solution

A single TypeScript module (`client-apps/web/src/utils/draft-session.ts`) that serves as the single source of truth for the draft-session contract: the URL shape (`/?draft=<type>`), the valid resource types, and the system-agent mapping.

## Implementation Details

Four exports in one file (~70 lines):

- **`DraftResourceType`** — `"agent" | "skill" | "mcp-server"` union type for type-safe references
- **`CREATOR_AGENTS`** — `Record<DraftResourceType, ResourceRef>` mapping each type to its system agent (`stigmer/agent-creator`, `stigmer/skill-creator`, `stigmer/mcp-server-creator`)
- **`getDraftSessionUrl(resourceType)`** — Returns `/?draft=<type>` for use as `<Link href>` values
- **`parseDraftParam(searchParams)`** — Validates the `?draft=` param against known types, returns `DraftResourceType | null`

### Placement Decision

Placed in `client-apps/web` (not SDK) because URL generation is tied to Console routing and the system-agent mapping is a Console UX decision. Platform builders use `useAgentSetup` + `useCreateSession` directly with their own routing.

### Discovery: `lib/` gitignore collision

Originally planned for `src/lib/` (Next.js convention), but `.gitignore` line 35 (`lib/`) — a Python build artifact pattern — silently ignores any `lib/` directory at any depth. Relocated to `src/utils/` which works naturally with no gitignore modifications.

## Benefits

- Single source of truth for draft session URL shape and system-agent mapping
- Type-safe — `DraftResourceType` prevents invalid resource type strings
- Defensive parsing — `parseDraftParam` validates before returning, no unsafe casts at call sites
- Extensible — adding new resource types (e.g., `"workflow"`) or URL params (Phase 4 edit flow) is additive

## Impact

- **T03.2** (SessionLauncher pre-fill) will import `parseDraftParam` and `CREATOR_AGENTS` to read and resolve the query param
- **T03.3** (Library button wiring) will import `getDraftSessionUrl` to replace the current `href="/"` on all "Create" buttons
- No existing behavior changed — this is purely additive infrastructure

## Related Work

- Phase 1 (T01.1–T01.13): Library pages with placeholder "Create" buttons
- Phase 2 (T02.1–T02.8): Execution artifacts widget and apply flow
- T03.2 (next): SessionLauncher pre-fill support
- T03.3 (next): Wire Library buttons to use `getDraftSessionUrl`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
