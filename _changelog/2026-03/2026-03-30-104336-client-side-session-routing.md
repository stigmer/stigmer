# Client-Side Session Routing — Eliminate Full-Page Refresh on Session Switch

**Date**: March 30, 2026

## Summary

Introduced a client-side session router that bypasses Next.js routing for session navigation, eliminating the full-page refresh that occurred every time a user switched between sessions in the sidebar. The solution uses `history.pushState` and React state to swap session content without tearing down the React tree, matching the ChatGPT-style seamless session switching experience.

## Problem Statement

Clicking a session in the Console sidebar triggered a full browser document reload, causing a visible "flicker" — the entire React tree (providers, auth, sidebar, SDK client, streaming connections) was destroyed and re-bootstrapped from scratch.

### Pain Points

- Every session switch reloaded auth, config, org data, and the session list from the server
- Any draft text typed in the new-session composer was lost when navigating away and back
- The experience felt sluggish and disorienting compared to modern chat UIs (ChatGPT, Claude, etc.)
- Active streaming connections were dropped and had to reconnect

### Root Cause

The Console uses a **Next.js static export** (`output: "export"`). In this mode, Next.js cannot perform soft (client-side) navigation to dynamic routes not pre-rendered by `generateStaticParams()`. Only a `__placeholder__` page is pre-rendered for `/sessions/[id]`, so the codebase intentionally used bare `<a href>` tags and `window.location.href` for session links — both of which cause full document navigations.

## Solution

A `SessionNavigationProvider` context that manages session switching entirely via React state + `history.pushState`. The app shell, sidebar, providers, and SDK client all stay mounted across session transitions.

## Implementation Details

### New File

- **`client-apps/web/src/contexts/session-navigation.tsx`** — Context provider with `activeSessionId` state, `navigateToSession(id)` and `navigateToHome()` methods. Syncs URL via `pushState`, handles browser back/forward via `popstate`, and detects Next.js `<Link>` navigations away from the session zone via `usePathname()`.

### Modified Files

- **`AppShell.tsx`** — When in the "session zone" (home or session view), renders content from the navigation context instead of Next.js `{children}`. The `SessionLauncher` stays mounted but CSS-hidden when viewing a session, preserving draft composer text across navigation.

- **`Sidebar.tsx`** — Session links now use `onClick` + `e.preventDefault()` + `navigateToSession(id)` instead of bare `<a href>`. The `href` attribute is preserved for accessibility (right-click "Open in new tab" still works). Active session detection migrated from `usePathname()` to the navigation context.

- **`SessionLauncher.tsx`** — Replaced `navigateTo()` (full-page reload) with `navigateToSession()` (pushState) after session creation.

- **`SessionPage.tsx`** — Exported `SessionPageInner` and `SessionSkeleton` as named exports for direct use by `AppShell`.

- **`page.tsx` / `sessions/[id]/page.tsx`** — Reduced to thin no-op placeholders since `AppShell` manages session zone rendering. `generateStaticParams` retained for nginx SPA fallback.

- **`McpServerDetailPage.tsx`** — Migrated session navigation from `navigateTo()` to `navigateToSession()`.

- **`layout.tsx`** — Added `SessionNavigationProvider` wrapping `AppShell`.

### Key Design Decision: `isSessionZone`

The provider tracks whether the app is in the "session zone" (home or session view) vs. a non-session route (e.g. `/library`). This allows `AppShell` to seamlessly fall back to Next.js `{children}` for library pages while managing session views with React state.

A `usePathname()` watcher detects when Next.js `<Link>` navigates away from the session zone, clearing the session state so library routes render correctly.

## Benefits

- **Zero full-page reloads** when switching between sessions
- **Draft text preserved** — new-session composer content survives navigation to existing sessions and back
- **Instant session switching** — only the main content area re-renders; sidebar, auth, org, theme all stay mounted
- **Browser back/forward works** — `popstate` handler keeps URL and state in sync
- **Accessibility preserved** — `<a href>` still present for right-click, Cmd+click, middle-click
- **Zero SDK changes** — all changes are Console-only (`client-apps/web`), no impact on `@stigmer/react` or `@stigmer/sdk`

## Impact

- **End users**: Noticeably faster, flicker-free session switching
- **Platform builders**: No impact — all changes are in Console; SDK packages untouched
- **Architecture**: Establishes the pattern for client-side routing within the session zone while keeping Next.js routing for other areas (library, future pages)

## Related Work

- Nginx SPA fallback configuration (unchanged, still serves `__placeholder__.html`)
- Static export deployment model (unchanged, `output: "export"` retained)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 day
