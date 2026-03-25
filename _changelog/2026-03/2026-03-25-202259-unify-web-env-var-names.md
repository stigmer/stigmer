# Unify Web Console Environment Variable Names

**Date**: March 25, 2026

## Summary

Standardised all web console environment variables to use the `NEXT_PUBLIC_*` prefix across local development, Docker containers, and Kubernetes deployments. Previously, two separate naming conventions caused `.env` files with production values to be silently ignored during `next dev`, forcing developers to maintain mental mappings between two sets of names.

## Problem Statement

The web console had a split configuration system with two sets of environment variable names for the same values:

| Context | Variable Names |
|---|---|
| Docker entrypoint / Kustomize | `API_URL`, `AUTH_MODE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE` |
| Next.js local dev | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_OIDC_ISSUER`, `NEXT_PUBLIC_OIDC_CLIENT_ID`, `NEXT_PUBLIC_OIDC_AUDIENCE` |

### Pain Points

- **Silent failure**: Putting production values in `.env` with bare names (e.g. `API_URL=https://...`) did nothing during `next dev` — the app fell back to `localhost:7234` defaults and showed "Local mode" with no error or warning.
- **Confusing DX**: Developers had to know which set of names to use depending on the context, and the `.env.example` didn't match the kustomize overlay or Docker entrypoint.
- **Two code paths**: The runtime config loader first tried `/config.json` (populated by the Docker entrypoint using bare names), then fell back to `process.env.NEXT_PUBLIC_*`. These two paths read different variable names, making the whole system harder to reason about.

## Solution

Standardised on `NEXT_PUBLIC_*` as the single canonical set of environment variable names. The Docker entrypoint and Kustomize overlay now inject the same `NEXT_PUBLIC_*` variables that Next.js reads natively. This eliminates the naming divergence entirely.

## Implementation Details

Five files changed, all under `client-apps/web/`:

- **`_kustomize/overlays/prod/service.yaml`** — Renamed all five env var keys from bare names to `NEXT_PUBLIC_*` prefix. The `$variables-group` value references remain unchanged.
- **`entrypoint.sh`** — Updated the `config.json` template to read `${NEXT_PUBLIC_API_URL}`, `${NEXT_PUBLIC_AUTH_MODE}`, etc. instead of `${API_URL}`, `${AUTH_MODE}`, etc.
- **`Dockerfile`** — Updated comment to reflect the unified naming approach.
- **`src/config/runtime-config.ts`** — Updated the module-level documentation, and changed error messages in `validateOidcFields()` to reference the correct `NEXT_PUBLIC_*` variable names.
- **`.env.example`** — Reworded the header to explain that one set of names works everywhere (local dev, Docker, Kubernetes). Removed the "local development only" framing.

The `.env` file (gitignored) was also updated locally to use the correct names.

## Benefits

- **One set of names everywhere**: No more mental mapping between `API_URL` and `NEXT_PUBLIC_API_URL`.
- **`.env` just works**: Copy production values into `.env`, run `next dev`, and the app connects to the right backend — no silent fallback to localhost.
- **Better error messages**: Validation errors now reference the actual variable names developers need to set.
- **Zero runtime behaviour change**: The config loading logic (`fetchConfigJson` → `buildFromEnv` fallback) is unchanged. Only the environment variable names fed into the system changed.

## Impact

- **Developers**: Can now use a single `.env` file with production or staging values during local development without surprises.
- **Kubernetes/Prod**: Requires updating the variable group values in the deployment platform to inject `NEXT_PUBLIC_*` names instead of bare names. The `$variables-group` references in the kustomize overlay are unchanged, so only the platform-side mapping needs updating.
- **Docker**: Anyone running the container directly with `-e API_URL=...` will need to switch to `-e NEXT_PUBLIC_API_URL=...`.

## Related Work

This is a standalone configuration hygiene fix. No proto, backend, or SDK changes involved.

---

**Status**: ✅ Production Ready
