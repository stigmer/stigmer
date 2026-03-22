# Fix Web Docker Build for Monorepo Context

**Date**: March 22, 2026

## Summary

Resolved a persistent CI pipeline failure for the stigmer-web Docker build by fixing the build context configuration and declaring all workspace dependencies. The root cause was Planton using `projectRoot` as the Docker build context, making repo-root-relative paths in the Dockerfile unresolvable once the remote layer cache expired.

## Problem Statement

The stigmer-web CI pipeline failed on every build after the OIDC auth changes were merged. The Dockerfile used repo-root-relative paths (`COPY apis/stubs/ts/`, `COPY client-apps/web/`, `COPY package.json`) but Planton set the Docker build context to `projectRoot: client-apps/web`, not the repo root. Previous builds only succeeded because BuildKit served all layers from remote cache — once the cache missed (new commit tag not in GHCR), every COPY instruction failed.

### Pain Points

- `--local 'context=/workspace/source/client-apps/web'` in the buildctl command revealed the context was the projectRoot, not the repo root
- Remote cache masked the problem: cached layers resolved without touching the build context, so the mismatch was invisible until a cache miss
- The `dockerfilePath` was also doubled (`client-apps/web/client-apps/web/Dockerfile`) due to projectRoot + dockerfilePath concatenation
- The web app silently depended on `@stigmer/sdk`, `@stigmer/theme`, and `@stigmer/react` via workspace hoisting without declaring them in package.json

## Solution

Three coordinated fixes across the OSS and cloud repositories:

1. **Planton service config**: Removed `projectRoot` so the build context becomes the repo root. Set `dockerfilePath` to the full repo-relative path `client-apps/web/Dockerfile`.
2. **Dockerfile**: Added COPY instructions for all 4 workspace packages (`apis/stubs/ts/`, `sdk/typescript/`, `sdk/theme/`, `sdk/react/`) so `npm ci` can resolve workspace dependencies during the build.
3. **package.json**: Declared `@stigmer/sdk`, `@stigmer/theme`, and `@stigmer/react` as explicit `"*"` dependencies — they were already imported throughout the web app source but resolved only via npm workspace hoisting.

## Implementation Details

### Planton Service Config (`stigmer-web.yaml`)

- Removed `projectRoot: client-apps/web` — build context is now the repo root
- Changed `dockerfilePath` from `Dockerfile` to `client-apps/web/Dockerfile`
- Applied to Planton via `planton apply`

### Dockerfile Builder Stage

Added COPY instructions for SDK workspace packages alongside the existing proto stubs:

```dockerfile
COPY apis/stubs/ts/package.json apis/stubs/ts/
COPY sdk/typescript/package.json sdk/typescript/
COPY sdk/theme/package.json sdk/theme/
COPY sdk/react/package.json sdk/react/

COPY apis/stubs/ts/ apis/stubs/ts/
COPY sdk/typescript/ sdk/typescript/
COPY sdk/theme/ sdk/theme/
COPY sdk/react/ sdk/react/
```

### Web App Dependencies

Added to `client-apps/web/package.json`:

```json
"@stigmer/react": "*",
"@stigmer/sdk": "*",
"@stigmer/theme": "*"
```

### Root `.dockerignore`

Created at the repo root to keep the full-repo context transfer efficient:

```
.git
**/.next
**/node_modules
**/target
**/.env
**/.env.local
**/.env.*.local
```

## Benefits

- Docker build works from a clean state (no cache dependency)
- All workspace dependencies are explicitly declared — no hidden reliance on hoisting
- Workspace refs (`"*"`) preserve the monorepo development workflow: any proto or SDK change is immediately available to the web build without publishing to npm first
- Root `.dockerignore` keeps the context transfer fast despite using the full repo

## Impact

- **CI/CD**: Unblocks the stigmer-web pipeline permanently
- **Developer Experience**: `npm install` within `client-apps/web` now correctly resolves all `@stigmer/*` dependencies
- **Architecture**: Establishes the monorepo-root build context as the standard pattern for web app Docker builds in this repo

## Related Work

- `fix(web): inline entrypoint script in Dockerfile via heredoc` (8c28e4c3)
- `fix(ops): correct dockerfilePath for stigmer-web service` (e361c8ed in stigmer-cloud)
- `fix(ops): remove projectRoot and use full dockerfilePath for stigmer-web` (23b13afc in stigmer-cloud)

---

**Status**: Production Ready
