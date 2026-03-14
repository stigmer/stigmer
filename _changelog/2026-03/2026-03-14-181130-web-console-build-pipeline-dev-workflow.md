# Web Console Build Pipeline & Dev Workflow

**Date**: March 14, 2026

## Summary

Integrated the web console into the CI release pipeline, rewrote the Dockerfile for static export with nginx, and cleaned up all Kubernetes manifests. This completes the build infrastructure for shipping the web console both embedded in the CLI binary and as a standalone Docker image for cloud deployment.

## Problem Statement

With the web console migrated to the OSS repo (T01–T06), the build pipeline and deployment artifacts were still pointing at the old `stigmer-cloud` repo. The Dockerfile used Yarn and Next.js standalone mode (incompatible with the new static export). Kustomize manifests had stale Auth0/NextAuth references and grossly oversized resource limits. The CLI release workflow had no awareness of the web console.

### Pain Points

- CI release produced CLI binaries without the web console embedded
- Dockerfile was broken — used Yarn (migrated to npm) and `next start` (incompatible with `output: "export"`)
- Kustomize manifests referenced `stigmer-cloud` image repo and had 10+ stale environment variables
- Resource limits sized for Node.js SSR (2Gi memory) when nginx needs 64Mi
- No documented workflow for the three deployment modes (dev, CLI embed, Docker)
- Root Makefile didn't clean or lint web console artifacts

## Solution

A build-once, consume-everywhere CI architecture: the web console is built once in a dedicated CI job, uploaded as an artifact, and consumed by platform-specific Go build jobs and (separately) by the Dockerfile for cloud images.

## Implementation Details

### CI Pipeline (`release.cli.yaml`)

Added `build-web-console` job running in parallel with agent-runner linting:
- Checks out repo, generates TypeScript proto stubs via Buf
- Sets up Node.js 22, runs `npm ci`, lints with ESLint, builds static export
- Uploads `client-apps/web/out/` as `web-console-assets` CI artifact

Updated all three platform build jobs (`darwin-arm64`, `darwin-amd64`, `linux-amd64`):
- Added `build-web-console` to `needs` dependency array
- Download artifact into `client-apps/cli/embedded/webconsole/out/`
- Compile with both `embed_agentrunner embed_webconsole` build tags

### Dockerfile

Multi-stage build replacing the broken Yarn/standalone configuration:
- **Builder** (`node:22-alpine`): `ARG`→`ENV` pattern for `NEXT_PUBLIC_AUTH_MODE` and `NEXT_PUBLIC_API_URL` (build-time config for static export), npm workspaces install and build
- **Runtime** (`nginx:alpine`): serves static files on port 3000 with OCI labels

### nginx Configuration

Created `client-apps/web/nginx.conf` with:
- Immutable caching for Next.js hashed assets (`/_next/static/`)
- `no-cache` for `index.html` (ensures fresh JS/CSS references after deploy)
- SPA fallback with `.html` suffix support (Next.js exports `/about` as `about.html`)

### Kustomize Cleanup

Across base + local + prod overlays:
- Image repo: `stigmer-cloud` → `stigmer`
- Removed all stale Auth0/NextAuth env vars and secrets (10+ entries)
- Right-sized resources: 64Mi (base) / 128Mi (prod) memory limits for nginx
- Added comments documenting that `NEXT_PUBLIC_*` is build-time only

### Root Makefile

- `clean`: removes `client-apps/cli/embedded/webconsole/out/` and `client-apps/web/out/ .next/`
- `lint`: runs ESLint on `client-apps/web` with graceful skip when `node_modules` not installed

## Benefits

- **CI efficiency**: Web console built once, not three times per platform
- **Correct Docker image**: actually builds and runs (was broken with Yarn/standalone references)
- **10x smaller runtime**: nginx:alpine vs Node.js image; 64Mi vs 2Gi memory
- **Clean manifests**: no misleading stale environment variables or oversized resources
- **Documented workflows**: README covers dev, CLI embed, and Docker build paths
- **Artifact consistency**: same static export consumed by both Go embed and Docker image

## Impact

- **Release pipeline**: CLI binaries now ship with embedded web console
- **Cloud deployment**: Docker image builds correctly with configurable auth mode and API URL
- **Developer experience**: documented paths for all three build workflows
- **Operations**: resource costs reduced by ~16x for cloud-deployed web console pods

## Related Work

- [Web Console OSS Migration](2026-03-14-160705-migrate-web-console-to-oss.md) — T02 initial migration
- [Configurable Auth](2026-03-14-162620-web-console-configurable-auth.md) — T03 auth module
- [Static Export Build](2026-03-14-170358-web-console-static-export-build.md) — T04 static export
- [Embed + gRPC-Web](2026-03-14-173149-embed-web-console-grpc-web-backend.md) — T05 daemon embedding
- [CLI Integration](2026-03-14-174816-cli-web-console-integration.md) — T06 CLI commands

---

**Status**: ✅ Production Ready
**Timeline**: Final task (T07/T07) of Web Console OSS Migration project
