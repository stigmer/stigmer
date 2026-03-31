# Fix Static Export Navigation and Agent Runner Connectivity

**Date**: March 24, 2026

## Summary

Completed the fix for broken navigation on the cloud-deployed Console and resolved the agent runner's inability to connect to the Stigmer backend API. The navigation fix required three layers: replacing soft navigation with full page loads, adding an nginx regex fallback for dynamic route HTML, and resolving `__placeholder__` route params from the actual URL. The agent runner fix switches from the public ingress endpoint to the internal Kubernetes service endpoint.

## Problem Statement

Two interrelated issues on the cloud deployment:

1. **Console navigation broken**: Clicking sessions or library items either stayed on the home page or showed "Failed to load session — unauthorized to get session" because `useParams()` returned `__placeholder__` from the pre-rendered HTML.

2. **Agent runner disconnected**: The `generate_session_subject` Temporal activity failed with gRPC `UNAVAILABLE` — the agent runner was trying to reach the Stigmer API through the public ingress (`api.stigmer.ai:443`) using native gRPC, which the ingress rejected with "Connection reset by peer."

### Pain Points

- Sessions created successfully but the user never saw them (stuck on home page)
- "Failed to load session — unauthorized to get session" when navigation did work (placeholder ID sent to backend)
- Agent runner could not generate session subjects (background task)
- Both issues only manifested in cloud deployment, worked fine locally

## Solution

### Console Navigation (3 commits)

1. **Full page navigation** (`navigateTo()` utility): Replaced `router.push` and `<Link>` with `window.location.href` for all dynamic routes. Prevents Next.js from attempting soft navigation that fails without RSC flight data.

2. **Nginx dynamic-route fallback**: Added `location ~ ^(.+)/[^/]+$` regex that serves `__placeholder__.html` from the parent directory. Self-maintaining — new dynamic routes that follow the `generateStaticParams` convention work automatically.

3. **`useStaticRouteParam` hook**: Detects when `useParams()` returns `__placeholder__` (from pre-rendered HTML) and extracts the real value from `window.location.pathname`. Prevents API calls with the placeholder ID.

### Agent Runner Connectivity

Switched `STIGMER_BACKEND_ENDPOINT` from the public endpoint (`api.stigmer.ai:443`) to the internal Kubernetes service (`stigmer-service.stigmer-prod.svc.cluster.local:80`). Direct pod-to-pod communication over plain gRPC, bypassing the ingress entirely.

## Implementation Details

**Console files changed:**

- `client-apps/web/src/utils/navigation.ts` — **New**: `navigateTo()` utility
- `client-apps/web/src/hooks/useStaticRouteParam.ts` — **New**: placeholder resolution hook
- `client-apps/web/nginx.conf` — Regex dynamic-route fallback, `^~` on `/_next/static/`
- `SessionLauncher.tsx`, `Sidebar.tsx` — Navigation method changes
- `AgentListPage.tsx`, `SkillListPage.tsx`, `McpServerListPage.tsx`, `AgentDetailPage.tsx`, `LibraryLanding.tsx` — `router.push` → `navigateTo`
- `SessionPage.tsx` — Split into wrapper + inner component for param resolution
- `SkillDetailPage.tsx`, `McpServerDetailPage.tsx` — `useStaticRouteParam` + loading guard

**Agent runner files changed:**

- `backend/services/agent-runner/_kustomize/overlays/prod/service.yaml` — Endpoint from `prod.endpoint` to `prod.kube-endpoint`

## Benefits

- All Console navigation works correctly on cloud deployments
- Agent runner connects reliably to the backend via internal cluster networking
- Nginx regex fallback is self-maintaining for future dynamic routes
- `useStaticRouteParam` hook is reusable for any future dynamic route page
- Single revert point (`navigateTo()`) if the Console moves to server-rendered deployment

## Impact

- **Users**: Cloud Console navigation fully functional
- **Agent runner**: Session subject generation and other API calls restored
- **Scope**: Console (`client-apps/web`) + agent runner kustomize config — no SDK changes

## Related Work

- `stigmer-cloud` variables-group: Added `prod.kube-endpoint` to `stigmer-api` for internal service discovery
- Verified Kubernetes service port mapping via `kubectl` (`port: 80 → targetPort: 8080`)

---

**Status**: ✅ Production Ready
