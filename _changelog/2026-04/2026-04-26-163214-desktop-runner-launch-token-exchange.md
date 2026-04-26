# Desktop Runner: Proper Launch Token Exchange and Org Resolution

**Date**: April 26, 2026

## Summary

Fixed "Start Runner" in the desktop app by implementing the proper launch token exchange flow. The previous approach passed the desktop's Auth0 access token directly, but the CLI sidecar expects a Stigmer-signed JWT. The fix mirrors the existing deep-link flow: mint a launch token, exchange it for a Stigmer JWT, and pass the JWT + org + gRPC-formatted endpoint to the sidecar.

## Problem Statement

Clicking "Start Runner" in the desktop Runners page silently failed. Three distinct issues combined to produce no visible result.

### Pain Points

- **Wrong token type**: The Auth0 access token was passed to the CLI, but the Go SDK (plain gRPC, not Connect-RPC) expects a Stigmer-signed JWT
- **Missing org**: The sidecar never passed `--org` to the CLI; the CLI resolved org from `~/.stigmer/config.yaml` which could be empty
- **Wrong endpoint format**: The Go SDK's `WithBaseURL` expects `host:port` (e.g. `api.stigmer.ai:443`), but the desktop passed an HTTP URL (e.g. `https://api.stigmer.ai`)
- The deep-link flow had the same org and endpoint format gaps (latent bugs)

## Solution

Replaced direct Auth0 token injection with the existing `createLaunchToken` / `exchangeLaunchToken` API handshake. This is the same mechanism the web-to-desktop deep-link flow uses, minus the URL scheme hop.

## Implementation Details

- **`RunnersPage.tsx`**: `handleStart` now calls `createLaunchToken({ org })` then `exchangeLaunchToken({ token })` to obtain a Stigmer JWT + org before invoking the sidecar
- **`useDeepLinkHandler.ts`**: Fixed pre-existing gaps -- now passes `org` from the exchange response and converts the base URL to gRPC target format
- **`grpc-target.ts`**: New utility that converts HTTP URLs to gRPC targets (`https://api.stigmer.ai` -> `api.stigmer.ai:443`)
- **`sidecar.rs` + `tauri.ts`**: Added `org` parameter so the sidecar can pass `--org` to the CLI (landed in prior commit)

## Benefits

- "Start Runner" now produces the correct credential type the CLI expects
- Org is always included, eliminating silent Apply failures
- Endpoint is correctly formatted for the Go gRPC SDK
- Deep-link flow is also hardened against the same latent bugs

## Impact

- **Desktop app users**: Runner start works correctly after logging in
- **Deep-link flow**: Now passes org and correctly formatted endpoint
- **Scope**: 3 files modified, 1 new utility file, across TypeScript only (Rust changes landed in prior commit)

---

**Status**: Production Ready
