# Fix Dockerfile Entrypoint Build Failure with Inline Heredoc

**Date**: March 22, 2026

## Summary

Resolved a CI pipeline build failure where Docker could not find `client-apps/web/entrypoint.sh` in the build context. The fix inlines the entrypoint script directly in the Dockerfile using BuildKit's heredoc COPY syntax, eliminating the external file dependency entirely.

## Problem Statement

After adding the runtime configuration entrypoint script (`entrypoint.sh`) and deploying via Planton's CI pipeline, the Docker build failed at the `COPY client-apps/web/entrypoint.sh /entrypoint.sh` instruction with "not found" despite the file being tracked in git and present in the merge commit.

### Pain Points

- BuildKit imported remote cache layers from a previous successful build (pre-entrypoint)
- All existing COPY layers resolved from cache without touching the build context
- The new `COPY entrypoint.sh` instruction had no cache hit, forcing a build-context read that failed
- The Planton pipeline's Dockerfile path resolution (`projectRoot` + `dockerfilePath`) also needed correction from a doubled path

## Solution

Replaced the external `COPY client-apps/web/entrypoint.sh` with BuildKit's heredoc COPY syntax (`COPY <<'ENTRYPOINT' /entrypoint.sh`). The script content is now embedded directly in the Dockerfile, making the build self-contained and independent of build-context file resolution.

## Implementation Details

- Added `# syntax=docker/dockerfile:1` directive to enable BuildKit heredoc support
- Used `COPY <<'ENTRYPOINT' /entrypoint.sh` with a quoted delimiter to prevent variable expansion during build
- The inner heredoc (`<<CONFIGJSON`) remains literal in the file and is expanded at container runtime
- Also fixed `dockerfilePath` in the Planton service config from `client-apps/web/Dockerfile` to `Dockerfile` (relative to `projectRoot`)

## Benefits

- Build no longer depends on external entrypoint.sh being resolvable in the build context
- Self-contained Dockerfile — the runtime behavior is fully visible in one file
- Eliminates remote cache interaction issues for new file additions

## Impact

- **CI/CD**: Unblocks the stigmer-web pipeline that was failing on every build
- **Operations**: The standalone `entrypoint.sh` file remains in the repo for local reference but is no longer used by the Docker build

## Related Work

- Parent change: `feat(web): add OIDC authentication and runtime configuration` (ea03ceaa)
- Planton service fix: `fix(ops): correct dockerfilePath for stigmer-web service` (e361c8ed)

---

**Status**: Production Ready
