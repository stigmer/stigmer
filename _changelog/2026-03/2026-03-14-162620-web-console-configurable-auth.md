# Web Console: Configurable Auth Module

**Date**: March 14, 2026

## Summary

Established a provider-pattern auth abstraction for the Stigmer Web Console, consolidating all authentication concerns into a dedicated bounded module at `src/auth/`. The module supports two modes — `disabled` (fully implemented for local OSS use) and `oidc` (interface defined for future cloud deployment) — with `useAuth()` as the sole public API for all auth consumers.

## Problem Statement

The web console was migrated from stigmer-cloud to stigmer OSS in T02 with auth stripped out as no-op stubs scattered across `components/auth/`, `hooks/`, `lib/`, and `config/`. This left the codebase with:

### Pain Points

- Auth-related code spread across four directories with no cohesive structure
- No abstraction layer — adding OIDC support later would require touching many files
- The transport layer directly imported from `lib/auth-token.ts` with no clear ownership
- No formal contract for auth state — components couldn't consistently check authentication status
- API URL defaulted to `localhost:8080` instead of the actual stigmer-server port (7234)

## Solution

Created `src/auth/` as a bounded module implementing the Strategy pattern via React context. The auth mode is determined by a single environment variable (`NEXT_PUBLIC_AUTH_MODE`), and the entire app interacts with auth exclusively through the `useAuth()` hook. The module is designed so that adding OIDC support requires implementing one new provider component without touching any consumer code.

## Implementation Details

### Module Structure (10 files)

```
src/auth/
  types.ts                    — AuthMode, AuthUser, AuthState, AuthConfig
  config.ts                   — Reads NEXT_PUBLIC_AUTH_MODE, validates, defaults to "disabled"
  context.tsx                 — AuthContext (separated to prevent circular imports)
  use-auth.ts                 — useAuth() hook (sole public API)
  token-store.ts              — getAuthToken/setAuthToken (auth-transport bridge)
  AuthProvider.tsx             — Reads config, delegates to mode-specific provider
  AuthGuard.tsx                — Blocks rendering until auth resolves
  index.ts                    — Barrel export (public API boundary)
  disabled/
    DisabledAuthProvider.tsx   — Always-authenticated, no token, no login/logout
  oidc/
    types.ts                   — OidcConfig interface (issuer, clientId, audience, scopes)
```

### Provider Nesting

```
<Providers>                    ← composition root (layout.tsx)
  <AuthProvider>               ← selects mode-specific provider
    <DisabledAuthProvider>     ← or OidcAuthProvider (based on config)
      <AuthGuard>              ← passthrough when disabled; spinner+redirect for OIDC
        <OrgProvider>          ← fetches organizations (unchanged)
          <AppShell>
            {children}
          </AppShell>
        </OrgProvider>
      </AuthGuard>
    </DisabledAuthProvider>
  </AuthProvider>
</Providers>
```

### Key Design Patterns

- **Strategy via context**: `AuthProvider` reads the config once and renders the mode-specific implementation. Adding a new mode is one new component + one switch case.
- **Token store as bridge**: Module-level variable decouples React context from the Connect-RPC transport layer. Auth providers write tokens; the transport interceptor reads them. No hooks in the transport path.
- **Context separated from providers**: `context.tsx` is imported by both provider implementations and the `useAuth()` hook, preventing circular dependencies.
- **Barrel export as API boundary**: `index.ts` exports only `useAuth`, `AuthProvider`, `AuthGuard`, and the public types. Internal files are implementation details.

## Benefits

- **Single import for auth**: `import { useAuth } from "@/auth"` — one hook, full auth state
- **Zero-config local use**: Auth defaults to `disabled` without any environment variables
- **Future-proof**: OIDC support requires implementing one provider component; no consumer code changes
- **Clean module boundary**: Auth concerns colocated in one directory instead of scattered across four
- **No breaking changes**: Existing pages render identically; transport behavior unchanged

## Impact

- **Web console developers**: Use `useAuth()` for any auth-dependent UI; `isAuthenticated` is always `true` in disabled mode, so conditional rendering works uniformly
- **Cloud deployment**: When OIDC is implemented, set `NEXT_PUBLIC_AUTH_MODE=oidc` and provide OIDC config — no app code changes needed
- **T04 (static export)**: Auth module is client-side only, compatible with `output: 'export'`
- **T05 (Go embedding)**: Config resolution can be extended to read from `/api/config` runtime endpoint without changing the auth abstraction

## Related Work

- **T01**: Proto TypeScript Codegen Setup — established `@stigmer/protos` package
- **T02**: Migrate Web Source to Stigmer Repo — created the no-op auth stubs that T03 replaces
- **T04** (next): Configure Static Export Build — will determine OIDC rendering approach

---

**Status**: ✅ Production Ready (disabled mode); OIDC mode interface-only
**Timeline**: Single session
