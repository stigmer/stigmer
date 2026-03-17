# GitHub OAuth Workspace Integration

**Date**: March 17, 2026

## Summary

Replaced the manual GitHub URL and branch text inputs for workspace selection with a GitHub OAuth-driven repository picker. Users can now connect their GitHub account, browse their repositories, select a repo and branch, and add it as a workspace — all inline within the session launcher. The implementation spans a new proto service, Go and Java backend OAuth endpoints, TypeScript and React SDK components, and web console integration.

## Problem Statement

The previous workspace selection required users to manually type a GitHub repository URL and branch name into text fields. This was error-prone, slow, and required users to recall exact repository URLs from memory.

### Pain Points

- Users had to remember and type full GitHub URLs (e.g., `https://github.com/org/repo`)
- Branch names had to be typed manually with no validation or autocomplete
- No connection between the user's GitHub identity and the workspace they were configuring
- The experience was far behind modern developer tools like Cursor, Claude Code, and Windsurf

## Solution

Implemented a GitHub OAuth flow that lets users connect their GitHub account once, then browse and select repositories through an inline picker UI. The architecture follows the existing platform patterns — proto-first, dual-backend (Go + Java), SDK-layered (TypeScript client → React hooks → styled components → Console integration).

## Implementation Details

### Proto Layer
- New `platform/github/v1` bounded context under `apis/ai/stigmer/platform/`
- `GitHubService` with two RPCs: `GetOAuthAuthorizeUrl` and `ExchangeOAuthCode`
- Both marked `is_skip_authorization = true` (utility endpoints, not domain resources)

### Go Backend (`stigmer-server`)
- `GitHubController` in `domain/github/controller/` implements both RPCs
- OAuth credentials from `STIGMER_GITHUB_CLIENT_ID` / `STIGMER_GITHUB_CLIENT_SECRET` env vars
- Registered on gRPC server alongside existing services

### Java Backend (`stigmer-cloud`)
- `@ConfigurationProperties` for `github.oauth.*` config binding
- `@AutoGrpcRouterController` for automatic gRPC route registration
- Pipeline-based handlers: `GetOAuthAuthorizeUrlHandler`, `ExchangeOAuthCodeHandler`

### TypeScript SDK (`@stigmer/sdk`)
- Hand-written `GitHubClient` class wrapping auto-generated Connect-RPC stubs
- Added `github` property to main `Stigmer` client class

### React SDK (`@stigmer/react`)
- `useGitHubConnection` — manages full OAuth lifecycle with localStorage token persistence
- `useGitHubRepos` — fetches repos/branches from GitHub REST API
- `GitHubRepoPicker` — styled component with search, scrollable repo list, branch selector
- `WorkspaceEditor` — redesigned with two source buttons ("GitHub Repo" / "Local Folder") and progressive disclosure

### Web Console (`client-apps/web`)
- OAuth callback page at `/auth/github/callback`
- `useDeploymentMode` hook for local vs cloud detection
- `SessionLauncher` wires GitHub connection + deployment mode into `WorkspaceEditor`
- Go SPA handler updated with `.html` extension fallback for static routes

## Benefits

- **Recognition over recall**: Users browse repositories instead of typing URLs
- **Fewer errors**: Branch selection from a validated list instead of free-text input
- **Faster workspace setup**: 2-3 clicks vs typing a full URL + branch
- **Progressive disclosure**: "Connect GitHub" appears only when needed, repo picker only when connected
- **Token persistence**: GitHub connection survives page refreshes (localStorage), no re-auth on every session

## Impact

- **Users**: Streamlined workspace selection in the session launcher
- **Frontend SDK**: 4 new exports (hook, hook, component, redesigned component)
- **Backend (both)**: New `GitHubService` gRPC service with 2 endpoints
- **TypeScript SDK**: New `GitHubClient` on the `Stigmer` class
- **Architecture**: Established `platform` bounded context for utility services

## Related Work

- Prerequisite: GitHub OAuth App registration (documented in `_projects/2026-03/20260317.01.session-first-web-ux/tasks/T01_github_app_registration.md`)
- Follow-up: Phase 2 Local Folder Browser (documented in `_projects/2026-03/20260317.01.session-first-web-ux/tasks/T01_workspace_phase2_local_folder_browser.md`)
- Part of: `20260317.01.session-first-web-ux` project (session-first UX redesign)

---

**Status**: Production Ready (pending GitHub OAuth App registration)
**Timeline**: 1 session (~3 hours)
