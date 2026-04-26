# Sandbox Image Versioning: Eliminate Stale Daytona Cache

**Date**: April 26, 2026

## Summary

Daytona sandboxes were running stale Docker images because Daytona caches image tags for up to 24 hours without re-resolving them against the registry. The `:latest` tag was being used for sandbox provisioning, but Daytona never pulled the updated image. This caused the Python agent-runner to crash inside sandboxes with outdated code, manifesting as the UI stuck on "Almost ready..." indefinitely. The fix replaces `:latest` with immutable SHA-tagged images managed through Planton variables-group, with CI automatically updating the tag on every build.

## Problem Statement

After deploying fixes to the agent-runner (e.g., missing env vars, stale config attributes), new Daytona sandboxes continued running the old Docker image. The runner would crash on startup with errors from outdated code, but no error was surfaced to the user -- the UI just showed "Almost ready..." forever.

### Pain Points

- Daytona caches Docker image tags for 24 hours; no `imagePullPolicy` option exists in the SDK
- The `:latest` tag was used in production, which Daytona explicitly warns against in their Snapshots docs
- The CI pipeline already pushed SHA-tagged images (`main-<sha>`) but they were never referenced
- The cache-warming CI step also used `:latest`, warming the stale cache entry
- No way to tell which image version a sandbox is actually running

## Solution

Eliminate `:latest` from the production sandbox provisioning path. Use immutable `main-<sha>` tags and wire them through Planton variables-group so CI automatically updates the reference on every image build.

## Implementation Details

### CI Pipeline (`release.sandbox-cloud.yaml`)

- Added `plantonhq/install-planton-cli-action` for Planton CLI access
- After image push, CI renders a `daytona-ci` VariablesGroup manifest with the new `main-<sha>` tag and runs `planton apply` to update the variable
- Cache-warming step now uses the SHA-tagged image instead of `:latest`
- `PLANTON_API_KEY` GitHub Actions secret provides authentication

### Planton Variables-Group (`daytona-ci`)

- New dedicated variables-group exclusively owned by CI
- Single entry `prod.sandbox-image` holds the full image reference
- Separate from the human-managed `daytona` group to prevent accidental overwrites

### Kustomize Overlay (`service.yaml`)

- `STIGMER_RUNNER_LAUNCHER_SANDBOX_IMAGE` now references `$variables-group/daytona-ci/prod.sandbox-image`
- Replaces the hardcoded image tag
- Deployments automatically pick up whatever image CI last published

### What Stays the Same

- `DaytonaSandboxRunnerLauncher.java` -- no code changes, already reads from config
- `RunnerLauncherConfig.java` -- no changes, already reads the env var
- `application-runner-launcher.yaml` -- default stays `:latest` for local dev where Daytona is not used

## Benefits

- **Deterministic**: Every sandbox uses a specific, immutable image tag
- **Automatic**: CI updates the Planton variable on every build -- zero manual steps
- **Auditable**: Planton tracks which image each deployment uses with full audit trail
- **Rollback-safe**: Update the Planton variable to an older SHA tag to roll back
- **Daytona-friendly**: Each unique tag is a new cache entry, avoiding the 24h stale cache

## Impact

- **Production**: All new sandbox creations use the correct, latest image automatically
- **CI**: ~10 seconds added for Planton CLI install and `planton apply`
- **Architecture**: Establishes the pattern for CI-managed deployment variables via Planton

## Related Work

- `c77a6afa` (stigmer-cloud) -- fix: inject checkpointer and artifact storage proxy env vars into sandbox
- `93a00e15f` (stigmer) -- fix: startup crash from stale config attributes
- Side-Channel Proxy Phase 0 (`2026-04-20-185017`)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (investigation + planning + implementation)
