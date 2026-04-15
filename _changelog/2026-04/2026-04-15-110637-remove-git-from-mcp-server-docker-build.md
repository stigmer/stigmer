# Remove Unnecessary `git` Dependency from MCP Server Docker Build

**Date**: April 15, 2026

## Summary

Removed the `apk add --no-cache git` step from the MCP server Dockerfile that was causing flaky CI failures due to transient DNS errors. The `git` binary was never usable inside the Docker build context anyway, so the build now accepts a `BUILD_VERSION` build arg instead, which the CI workflow already computes.

## Problem Statement

The `build-docker-image` job in the MCP server release workflow was failing intermittently with DNS resolution errors when trying to install the `git` Alpine package.

### Pain Points

- Transient DNS failures on `dl-cdn.alpinelinux.org` caused the Docker build to fail
- The `git` package was installed solely for `git describe --tags`, but no `.git` directory exists inside the Docker build context — so the command always fell back to `echo docker`
- The Docker image was always stamped with version `"docker"` instead of the real release version, unlike the native binary builds which correctly received the version from the CI workflow

## Solution

- Replaced `RUN apk add --no-cache git` with `ARG BUILD_VERSION=docker` in the Dockerfile
- Changed the `-ldflags` to use `${BUILD_VERSION}` instead of shelling out to `git describe`
- Added `--build-arg BUILD_VERSION=$VERSION` to the `docker buildx build` command in the release workflow

## Implementation Details

**`mcp-server/Dockerfile`**: Removed the `git` package install and replaced it with a build arg. The `-ldflags` version injection now reads from `${BUILD_VERSION}` which defaults to `"docker"` for local builds.

**`.github/workflows/release.mcp-server.yaml`**: Added `--build-arg BUILD_VERSION=$VERSION` to forward the version (already computed by the `determine-version` job) into the Docker build stage.

## Benefits

- Eliminates a flaky CI failure caused by Alpine CDN DNS issues
- Docker images now carry the correct release version (e.g., `v1.2.3`) instead of always `"docker"`
- Faster Docker builds — no longer waiting to download and install the `git` package
- Parity with native binary builds which already pass the version via `-ldflags`

## Impact

- **CI/CD**: The `build-docker-image` job is more reliable and no longer depends on external Alpine package mirrors
- **Docker images**: Version reporting (`--version`, health endpoints) will now show the correct release version

---

**Status**: ✅ Production Ready
