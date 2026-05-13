# Server-Reported Deployment Mode Detection

**Date**: May 13, 2026

## Summary

Replaced the fragile URL-based deployment mode detection (localhost = OSS, else = Cloud) with a server-reported mechanism. The new `PlatformQueryController.getServerInfo` RPC lets the server authoritatively declare its edition, eliminating false positives from reverse proxies, containers, or LAN setups. Both client apps query the server on startup and fall back to URL guessing for backward compatibility with older servers.

## Problem Statement

Both the web console and desktop app determined whether they were connected to OSS or Cloud by checking if the API URL hostname was `localhost`. This meant:

- An OSS server behind a reverse proxy or running in a container on a LAN IP was incorrectly classified as "cloud"
- The desktop app always defaulted to `localhost:7234`, so it always got "local" mode even when it could have been pointed at cloud
- No way for the server to communicate its actual edition or capabilities

### Pain Points

- Billing and usage page visibility depended on a hostname heuristic, not the server's actual capabilities
- Platform builders embedding SDK components had to manually pass `deploymentMode` with no server-driven way to auto-detect it
- The detection logic was duplicated (once in desktop `App.tsx`, once in web `useDeploymentMode.ts`) with slightly different implementations

## Solution

Added a new proto service (`PlatformQueryController`) with a single unauthenticated RPC (`getServerInfo`) that returns the server edition (`oss` or `cloud`) and version. Implemented handlers in both the OSS Go server and Cloud Java server. Updated both client apps to query this endpoint on startup.

## Implementation Details

### Proto Contract

New file `apis/ai/stigmer/platform/v1/server_info.proto`:

- `PlatformQueryController` service with `getServerInfo` RPC (marked `is_public = true`)
- `ServerEdition` enum: `oss`, `cloud`
- `GetServerInfoOutput`: `edition` + `version` fields

### OSS Go Server

`backend/services/stigmer-server/pkg/domain/platform/controller/platform_controller.go`:
- Trivial handler returning `ServerEdition_oss` and a build version
- Registered in `server.go` alongside existing controllers

### Cloud Java Server (stigmer-cloud)

- `PlatformQueryGrpcAutoController.java` — annotation-driven gRPC router
- `GetServerInfoHandler.java` — returns `ServerEdition.cloud` and version from Spring config

### SDK TypeScript

`sdk/typescript/src/platform.ts`:
- `PlatformClient` class with `getServerInfo()` method
- Maps `ServerEdition.oss` -> `DeploymentMode = "local"`, `ServerEdition.cloud` -> `"cloud"`
- Wired into `Stigmer` class as `client.platform`

### Client App Changes

**Desktop** (`client-apps/desktop/src/App.tsx`):
- New `useServerDeploymentMode(client)` hook calls `client.platform.getServerInfo()` on mount
- Initializes with URL-based fallback, upgrades to server-reported mode asynchronously
- On error (older server), keeps the URL fallback

**Web** (`client-apps/web/src/domain/_shared/hooks/useDeploymentMode.ts`):
- Accepts optional `Stigmer` client parameter
- When provided, queries server for edition; falls back to URL detection on error
- `StigmerTransportBridge` passes its client to the hook

## Benefits

- Server authoritatively reports its edition — no more hostname guessing
- OSS servers on non-localhost URLs correctly report as OSS
- Desktop app pointed at cloud URL correctly shows billing and all cloud features
- Backward compatible: older servers without the RPC gracefully fall back to URL detection
- Platform builders can auto-detect deployment mode via `client.platform.getServerInfo()`

## Impact

- **Both client apps**: Deployment mode is now server-driven, not URL-driven
- **SDK consumers**: New `PlatformClient` available on `client.platform` for programmatic edition detection
- **OSS users**: Correct feature gating regardless of server URL
- **Cloud users**: Correct feature enablement regardless of proxy/network topology

## Related Work

- Previous commit `2ba7abaf9`: Removed incorrect Usage page gate and improved Billing messaging
- `20260513.01.cursor-experience-parity`: Parent project for usage tracking and UX improvements
- `sdk/typescript/src/resource-availability.ts`: `CLOUD_ONLY_KINDS` and `isResourceAvailable` — unchanged but now fed by server-reported mode

---

**Status**: Production Ready
