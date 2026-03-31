# Web OIDC Authentication and Runtime Configuration

**Date**: March 22, 2026

## Summary

Implemented client-side OIDC authentication using Authorization Code + PKCE flow for the Stigmer web console, and introduced a runtime configuration pattern that decouples environment-specific settings from the Docker build. This enables a single Docker image to serve any environment (dev, staging, production) with different API URLs, auth providers, and OIDC settings—injected at container startup rather than baked in at build time.

## Problem Statement

The Stigmer Cloud web console was deployed to production without authentication, meaning anyone with the URL could access the full management interface. Meanwhile, the existing Docker build pipeline baked `NEXT_PUBLIC_*` environment variables into the static JavaScript bundle at build time, making it impossible to reconfigure for different environments without rebuilding.

### Pain Points

- Production web console was publicly accessible with no login gate
- `NEXT_PUBLIC_*` variables were hardcoded at build time via Docker `ARG` directives
- Planton's deployment pipeline does not support `--build-arg`, so build-time env vars always fell back to defaults
- Production API URL and OIDC configuration would have been exposed in the OSS repository if hardcoded
- The existing auth module had a `disabled` mode for OSS but no working `oidc` mode for cloud
- Static export (`output: "export"`) for CLI embeddability ruled out server-side auth solutions like `next-auth`

## Solution

Two complementary systems were introduced:

1. **Runtime Configuration Pattern** — An `entrypoint.sh` script generates `/config.json` from container environment variables at startup. The web app fetches this JSON before rendering, falling back to `NEXT_PUBLIC_*` env vars for local development.

2. **Client-Side OIDC with PKCE** — Using `oidc-client-ts`, the web app performs Authorization Code + PKCE flow entirely in the browser. This is compatible with static export (no server-side sessions needed) and integrates with Auth0 as the identity provider.

## Implementation Details

### Runtime Config Module (`src/config/runtime-config.ts`)

- Defines a `RuntimeConfig` interface with `apiUrl`, `authMode`, `oidcIssuer`, `oidcClientId`, and `oidcAudience`
- `loadRuntimeConfig()` fetches `/config.json` from the server; falls back to `NEXT_PUBLIC_*` env vars if the fetch fails (local dev scenario)
- `getRuntimeConfig()` provides synchronous access to the loaded config for use throughout the app

### Config Initialization Gate (`Providers.tsx`)

- A `ConfigGate` component wraps the entire provider tree
- Blocks app rendering until `loadRuntimeConfig()` resolves
- Prevents race conditions where components attempt to read config before it's available

### Env Module Refactor (`src/config/env.ts`)

- Refactored to read from `getRuntimeConfig()` instead of `process.env.NEXT_PUBLIC_*`
- `getApiBaseUrl()` and `getIamApiAudience()` now return runtime-resolved values

### OIDC Manager (`src/auth/oidc/oidc-manager.ts`)

- Factory function `createUserManager` configures `oidc-client-ts` for Authorization Code + PKCE
- Injects Auth0-specific `audience` parameter via `extraQueryParams`
- Uses `sessionStorage` for OIDC state to survive page reloads without polluting persistent storage

### OIDC Auth Provider (`src/auth/oidc/OidcAuthProvider.tsx`)

- Detects `/auth/callback` path on mount and handles the code exchange via `signinRedirectCallback()`
- Restores existing sessions with `signinSilent()`, falling back to `getUser()` from storage
- Subscribes to `UserManager` events for token expiration and silent renewal
- Maps OIDC `User` to the app's `AuthUser` interface (id, email, name, avatar from ID token claims)
- Saves pre-login path and restores it after successful authentication

### Auth Callback Page (`src/app/auth/callback/page.tsx`)

- Minimal loading spinner page at `/auth/callback`
- Serves as the OIDC redirect URI; actual code exchange happens in `OidcAuthProvider`

### Auth Types and Config (`src/auth/types.ts`, `src/auth/config.ts`)

- `AuthConfig` refactored to a discriminated union: `{ mode: "disabled" }` or `{ mode: "oidc"; oidc: OidcConfig }`
- `resolveAuthConfig()` reads from runtime config and validates required OIDC fields

### Auth Provider Wiring (`src/auth/AuthProvider.tsx`)

- Uses `React.lazy()` to dynamically import `OidcAuthProvider` only when auth mode is `oidc`
- Keeps the bundle lean for `disabled` mode (OSS default)

### Docker and Nginx Changes

- **Dockerfile**: Removed `ARG NEXT_PUBLIC_*` build args; added `COPY entrypoint.sh` and `ENTRYPOINT ["/entrypoint.sh"]`
- **entrypoint.sh**: Generates `/config.json` from `API_URL`, `AUTH_MODE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE` env vars, then starts nginx
- **nginx.conf**: Added `Cache-Control: no-cache, no-store, must-revalidate` for `/config.json` to prevent stale config

### Kustomize Overlays

- **Base** (`_kustomize/base/service.yaml`): Removed stale comments about build-time env vars
- **Production** (`_kustomize/overlays/prod/service.yaml`): Added `env.variables` section referencing `$variables-group/stigmer-web-config/prod.*` for all runtime config values

### Cloud Repository Changes

- **Variables Group** (`stigmer-web-config.yaml`): Replaced old structure with production entries: `prod.api-url`, `prod.auth-mode`, `prod.oidc-issuer`, `prod.oidc-client-id`, `prod.oidc-audience`
- **Secrets Group** (`stigmer-web.yaml`): Deleted—`NEXTAUTH_SECRET` is no longer needed for client-side OIDC with PKCE
- **Planton Platform**: Applied the variables group and deleted the obsolete secrets group via Planton API

## Benefits

- **Single image, any environment**: One Docker build serves dev, staging, and production with different configurations
- **No secrets in OSS**: Production URLs and OIDC settings live in the cloud repository's variables groups, referenced by `$variables-group/` syntax in the OSS overlays
- **CLI embeddability preserved**: Static export (`output: "export"`) is unchanged; the runtime config pattern works with nginx-served static files
- **Lazy-loaded auth**: OIDC implementation is only downloaded when auth mode is `oidc`, keeping the disabled-mode bundle minimal
- **Auth0 PKCE security**: No client secrets needed—the SPA uses Authorization Code + PKCE, the most secure public client flow

## Impact

- **Security**: Production web console will require Auth0 login once deployed (pending Auth0 app type change to "Single Page Application")
- **Operations**: Environment configuration changes no longer require Docker rebuilds—just update the variables group and restart the container
- **Development**: Local dev continues to work with `.env` files or no configuration at all (defaults to `disabled` auth mode)
- **Architecture**: Establishes the runtime config pattern as the standard for all Stigmer web configuration going forward

## Prerequisites (Manual)

- Auth0 application type must be changed from "Regular Web Application" to "Single Page Application" in the Auth0 dashboard
- Callback URLs (`https://stigmer.planton.live/auth/callback`), logout URLs, and web origins must be configured in Auth0

## Files Changed

### New Files (OSS)
- `client-apps/web/src/config/runtime-config.ts`
- `client-apps/web/src/auth/oidc/OidcAuthProvider.tsx`
- `client-apps/web/src/auth/oidc/oidc-manager.ts`
- `client-apps/web/src/app/auth/callback/page.tsx`
- `client-apps/web/entrypoint.sh`
- `client-apps/web/.env.example`

### Modified Files (OSS)
- `client-apps/web/Dockerfile`
- `client-apps/web/nginx.conf`
- `client-apps/web/.gitignore`
- `client-apps/web/package.json` + `package-lock.json`
- `client-apps/web/src/config/env.ts`
- `client-apps/web/src/auth/types.ts`
- `client-apps/web/src/auth/config.ts`
- `client-apps/web/src/auth/AuthProvider.tsx`
- `client-apps/web/src/components/auth/Providers.tsx`
- `client-apps/web/_kustomize/base/service.yaml`
- `client-apps/web/_kustomize/overlays/prod/service.yaml`

### Cloud Repository
- `_ops/planton/service-hub/variables-group/stigmer-web-config.yaml` — updated with runtime config entries
- `_ops/planton/service-hub/secrets-group/stigmer-web.yaml` — deleted (NEXTAUTH_SECRET no longer needed)

## Related Work

- Auth module foundation: `feat(web): implement configurable auth module with provider-pattern abstraction` (commit 36f3692c)
- Planton comparison analysis drove the architectural decisions for runtime config vs build-time injection
- Cloud backend already has JWT validation middleware (Auth0, API key, Federated JWT)—no backend changes needed

---

**Status**: ✅ Production Ready (pending Auth0 dashboard configuration)
**Timeline**: Single session implementation
