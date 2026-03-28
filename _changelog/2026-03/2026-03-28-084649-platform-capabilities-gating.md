# Platform Capabilities Gating (Proto-Derived)

**Date**: March 28, 2026

## Summary

Introduced a deployment-mode-aware resource availability system across the SDK layer (`@stigmer/sdk`, `@stigmer/react`) and the Stigmer Console. In local mode, cloud-only features like API Keys now show a clear info notice instead of the misleading "Unable to reach the server. Check your connection." error. The system derives availability from the proto-defined `ResourceTier` metadata on `ApiResourceKind` — the same source of truth the CLI uses.

## Problem Statement

The local Go server (`stigmer-server`) does not register services for cloud-only resources (API Keys, IAM Policy, Identity Account, Identity Provider). When the Settings page attempted to load API keys, the RPC failed and the SDK error sanitizer mapped it to a generic connectivity error — confusing users since the server was reachable.

### Pain Points

- "Unable to reach the server. Check your connection." displayed when API keys are simply not supported in local mode
- No mechanism existed to gate features based on deployment mode in the web console or SDK
- Platform builders embedding `@stigmer/react` components against a local backend would hit the same misleading error

## Solution

Leveraged the existing `ResourceTier` (`open_source` | `cloud_only`) metadata from `api_resource_kind.proto` as the single source of truth for feature availability. Built a three-layer system:

1. **`@stigmer/sdk`** — `isResourceAvailable(kind, mode)` function with a static set of cloud-only kinds mirroring the proto
2. **`@stigmer/react`** — `DeploymentModeContext` wired through `StigmerProvider`, `useResourceAvailable(kind)` hook, and `CloudFeatureNotice` component
3. **`client-apps/web`** — Console bridges its URL-derived deployment mode into the SDK provider; Settings page gates the API Keys section

## Implementation Details

### New files

| File | Layer | Purpose |
|------|-------|---------|
| `sdk/typescript/src/resource-availability.ts` | `@stigmer/sdk` | `DeploymentMode` type, `CLOUD_ONLY_KINDS` set, `isResourceAvailable()` |
| `sdk/react/src/deployment-mode.ts` | `@stigmer/react` | `DeploymentModeContext`, `useDeploymentMode()`, `useResourceAvailable()` |
| `sdk/react/src/internal/CloudFeatureNotice.tsx` | `@stigmer/react` | Themed info notice for unavailable features |

### Modified files

| File | Change |
|------|--------|
| `sdk/typescript/src/index.ts` | Export `DeploymentMode`, `isResourceAvailable` |
| `sdk/react/src/provider.tsx` | Added optional `deploymentMode` prop (default `"cloud"`) and `DeploymentModeContext.Provider` |
| `sdk/react/src/index.ts` | Export new hooks, component, and re-exports from SDK |
| `client-apps/web/.../StigmerTransportBridge.tsx` | Passes URL-derived deployment mode to `StigmerProvider` |
| `client-apps/web/.../ApiKeysSection.tsx` | Gates content with `useResourceAvailable(ApiResourceKind.api_key)` |

### Key design decisions

- **Static set over runtime proto reflection**: A `ReadonlySet<ApiResourceKind>` mirrors the proto's `tier` values. Simpler and faster than reading `kind_meta` extensions via `@bufbuild/protobuf`'s `getExtension()` at runtime, and equally correct.
- **SDK-first placement**: The availability system lives in `@stigmer/sdk` and `@stigmer/react`, not `client-apps/web`. Platform builders embedding Stigmer components get the same graceful degradation by passing `deploymentMode="local"` to `StigmerProvider`.
- **Show, don't hide**: Cloud-only sections remain visible with an informative notice rather than being hidden, so users discover the platform's full capabilities.
- **Backward-compatible**: `StigmerProvider` defaults `deploymentMode` to `"cloud"` — existing consumers see no behavior change.

## Benefits

- Eliminates the confusing "Unable to reach the server" error for local-mode users
- Establishes a reusable pattern for gating any cloud-only resource across the platform
- Platform builders get feature gating for free through the SDK provider
- Adding a new cloud-only resource requires only: set `tier: cloud_only` in proto, add to `CLOUD_ONLY_KINDS`, use `useResourceAvailable()` in UI

## Impact

- **End users**: Clear, accurate messaging when running in local mode
- **SDK consumers / platform builders**: New `deploymentMode` prop on `StigmerProvider` and `useResourceAvailable()` hook for feature gating
- **Maintainers**: Single source of truth (proto `ResourceTier`) for what's available where

## Related Work

- `useDeploymentMode()` in `client-apps/web` (pre-existing, URL-based detection) — now also consumed by `StigmerTransportBridge`
- `api_resource_kind.proto` `ResourceTier` enum — the authoritative metadata this system mirrors

---

**Status**: ✅ Production Ready
