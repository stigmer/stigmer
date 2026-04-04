# React SDK Reference Page

**Date**: April 4, 2026

## Summary

Added the hand-written React SDK reference page (`docs/sdk/react.mdx`) to the SDK Reference documentation section, completing the three manual pages planned under T06. The page covers installation, provider setup, deployment mode, and a domain quick-reference table for the 67 hooks and 59 components in `@stigmer/react`. Also scaffolded a sub-project for future TypeDoc-based auto-generation of per-domain reference pages.

## Problem Statement

The SDK Reference section had an SDK Overview page (Go/TS/Python/Java core SDK) and a Streaming how-to guide, but no entry point for the React SDK (`@stigmer/react`). The "What's next" card on the SDK Overview page linked to `/docs/sdk/react` — a dead link.

### Pain Points

- Developers using `@stigmer/react` had no reference page for installation, provider setup, or discovering available hooks and components
- The SDK Overview "What's next" card produced a 404 for the React SDK link
- No documentation existed for deployment mode (`"local"` vs `"cloud"`), `StigmerProvider` props, or the domain organization of the React SDK

## Solution

Wrote a Reference-type page (Diataxis) in the SDK register that serves as the entry point to `@stigmer/react`. The page follows the same voice and structure as `docs/sdk/index.mdx` but is React-only (no multi-language SDKTabs). It provides setup instructions and a domain orientation table without trying to document every individual hook or component — that work is deferred to auto-generated per-domain pages.

## Implementation Details

### New file: `docs/sdk/react.mdx` (~170 lines)

Seven sections:
1. **Intro** — what `@stigmer/react` provides, relationship to `@stigmer/sdk`
2. **Installation** — single npm install command with all 4 required peer deps, `@base-ui/react` noted as optional
3. **Setup** — complete working example: create client, wrap in `StigmerProvider`, import styles, `useStigmer()` escape hatch
4. **Deployment mode** — `"local"` vs `"cloud"`, `useDeploymentMode()`, `useResourceAvailable()`, `CloudFeatureNotice`
5. **StigmerProvider** — props reference table (client, deploymentMode, preset, className, children)
6. **Hooks and components** — domain quick-reference table with 16 rows, verified counts (67 hooks, 59 components)
7. **What's next** — cards to Streaming, Agent Execution, Session

### Modified: `docs/sdk/meta.json`

Added `"react"` before `"streaming"` in the pages array. Sidebar order: SDK Overview → React SDK → Streaming → Resources.

### New directory: `20260404.01.sp.react-sdk-docs-auto-generation/`

Sub-project with a 7-task plan (T01–T07) for building a TypeDoc-based pipeline to auto-generate per-domain reference pages from TSDoc comments in the React SDK source code.

## Benefits

- Fixes the dead link from SDK Overview's "What's next" card
- Developers can now find installation, setup, and orientation for `@stigmer/react` in one place
- Domain quick-reference table gives discoverability (which domain has which hooks/components) without maintaining exhaustive API docs by hand
- CSS isolation behavior documented (`stgm` class scoping)
- Deployment mode feature-gating pattern documented with working code example

## Impact

- **SDK Reference section**: Now has complete coverage — Overview (4 languages), React SDK, Streaming, and auto-generated Resources
- **React SDK users**: First official reference page for `@stigmer/react`
- **Future work**: Sub-project scaffolded for auto-generating detailed per-domain pages

## Related Work

- Parent project: `20260403.03.sdk-docs-auto-generation` (T06)
- Previous sessions: SDK Overview (session 7), Streaming guide (session 8)
- Sub-project: `20260404.01.sp.react-sdk-docs-auto-generation` (T01 plan pending review)

---

**Status**: Production Ready
**Timeline**: 1 session
