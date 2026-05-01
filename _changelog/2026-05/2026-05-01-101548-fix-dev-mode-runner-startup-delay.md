# Fix Dev-Mode Runner Startup Delay

**Date**: May 1, 2026

## Summary

Eliminated the 60-120 second startup delay when starting runners in dev mode via the desktop app. The fix injects a content-based build version into the CLI binary so that runtime managers skip expensive source re-extraction and dependency reinstallation when the embedded source hasn't changed.

## Problem Statement

After the async cursor-runner bootstrap fix (commit `4cb3e6475`), runners in dev mode still took 60-120 seconds to start. The runner would appear in a "Stopped" state in the UI for over a minute before finally transitioning to "Running," making local development painful.

### Pain Points

- Every `make desktop-dev` restart triggered a full Python `pip install` of two local packages (~60-90 seconds)
- Every restart also triggered a full Node.js `npm install` for the cursor-runner (~30-40 seconds)
- The delay occurred even when no source files had changed between restarts
- The UI showed "Stopped" during bootstrap, confusing developers into thinking the runner failed to start

## Solution

Set the `buildVersion` in `setup-sidecar-dev.sh` to a content hash of the embedded source directories (`dev-<12-char-hash>`) instead of leaving it as the default `"dev"`.

Both runtime managers (`pythonrt` and `nodert`) treat the literal string `"dev"` specially — they unconditionally run `refreshDevSource()`, which removes the app directory, re-extracts embedded source, and reinstalls all dependencies. By providing a stable version like `dev-a1b2c3d4e5f6`, the existing version-based caching in `IsReady()` works correctly: if the extracted version matches the build version, bootstrap is a no-op.

## Implementation Details

**File**: `client-apps/desktop/scripts/setup-sidecar-dev.sh`

The build step was changed from:

```bash
(cd "$CLI_DIR" && CGO_ENABLED=0 go build -tags 'embed_agentrunner embed_cursorrunner' -ldflags="-s -w" -o "$GOPATH_BIN" .)
```

To:

```bash
EMBED_HASH=$(cd "$CLI_DIR/embedded" && find agentrunner/source cursorrunner/source -type f 2>/dev/null | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12)
BUILD_VERSION="dev-${EMBED_HASH}"

(cd "$CLI_DIR" && CGO_ENABLED=0 go build \
  -tags 'embed_agentrunner embed_cursorrunner' \
  -ldflags="-s -w -X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=${BUILD_VERSION}" \
  -o "$GOPATH_BIN" .)
```

The hash is computed by checksumming all files under `agentrunner/source` and `cursorrunner/source`, then taking the first 12 characters of the combined hash. This produces versions like `dev-a4baea168b83` that are:

- **Stable across restarts** with unchanged source (same hash → cached → fast)
- **Different after source changes** (new hash → version mismatch → full bootstrap)
- **Not equal to `"dev"`** (bypasses the unconditional `refreshDevSource()` path)

No changes were needed to the runtime managers — the existing version-based caching logic works correctly once `buildVersion` is something other than the literal `"dev"`.

## Benefits

- **Dev-mode runner start time**: 60-120 seconds → 3-5 seconds (when source unchanged)
- **Correct cache invalidation**: Source changes still trigger full bootstrap
- **Zero runtime code changes**: Only the build script was modified
- **No behavioral change in production**: Production builds already set `buildVersion` via ldflags

## Impact

- **Developers**: Dramatically faster iteration cycle when working on the desktop app
- **Desktop app**: Runner appears as "Running" within seconds of clicking Start
- **CI/CD**: No impact — production builds are unaffected

## Related Work

- [Fix cursor-runner cloud availability](../_changelog/2026-04/2026-04-30-201753-fix-cursor-runner-cloud-availability.md) — the change that made `IsCursorRunnerAvailable` return true in more contexts, triggering the cursor-runner bootstrap
- [Fix runner start blocking and polling race](../_changelog/2026-04/2026-04-30-211323-fix-runner-start-blocking-and-polling-race.md) — moved cursor-runner bootstrap to a background goroutine and added polling grace period

---

**Status**: ✅ Production Ready
