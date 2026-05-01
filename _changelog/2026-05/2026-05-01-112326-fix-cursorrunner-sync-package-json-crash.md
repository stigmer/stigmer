# Fix cursorrunner sync.sh Package.json Crash on Node 23+

**Date**: May 1, 2026

## Summary

Fixed a crash in `client-apps/cli/embedded/cursorrunner/sync.sh` where Node.js v23+ would fail with `ERR_INVALID_PACKAGE_CONFIG` during the cursor-runner embedding step. The issue affected the local `make desktop-dev` flow and would eventually hit CI when runner Node versions are upgraded.

## Problem Statement

Running `make desktop-dev` crashed during the "Sync cursor-runner source for embedding" step with:

```
Error: Invalid package config .../cursorrunner/source/package.json.
    code: 'ERR_INVALID_PACKAGE_CONFIG'
```

### Pain Points

- `make desktop-dev` was completely broken for developers using Node.js v23+
- The error message pointed at `package.json` but gave no hint about the actual cause (shell redirect race)
- CI pipelines (`release.cli.yaml`, `release.desktop.yaml`) use the same `sync.sh` and would break as soon as GitHub Actions runners upgrade to Node 23+

## Solution

Applied the same temp-file pattern already used in Step 2b of `sync.sh` to Step 3. Instead of redirecting `node -e` output directly to `package.json` (which truncates the file to 0 bytes before the command runs), we now write to `package.json.tmp` and atomically rename it.

## Implementation Details

**Root cause**: In Step 3 of `sync.sh`, the shell evaluates the redirect `> "$SOURCE_DIR/package.json"` *before* launching `node -e`. This creates/truncates the file to 0 bytes. Since the CWD is `$SOURCE_DIR` (set by Step 2b), Node.js v23's module loader discovers the empty `package.json` during startup and crashes before the inline script even runs.

**The fix** (one line):

```diff
-" > "$SOURCE_DIR/package.json"
+" > "$SOURCE_DIR/package.json.tmp" && mv "$SOURCE_DIR/package.json.tmp" "$SOURCE_DIR/package.json"
```

This is the same pattern already used in Step 2b (line 72) of the same script for the protos `package.json` rewrite.

## Benefits

- Unblocks local development on Node.js v23+ (the user's environment: v23.1.0)
- Future-proofs CI pipelines against Node.js version upgrades
- Consistent pattern — both Step 2b and Step 3 now use the same safe temp-file approach

## Impact

- **Local dev**: `make desktop-dev` works again on Node 23+
- **CI**: `release.cli.yaml` (3 platform builds) and `release.desktop.yaml` (3 platform matrix) all invoke the same `sync.sh`, so the fix propagates automatically
- **No behavioral change**: The generated `package.json` content is identical; only the write strategy changed

## Related Work

- Previous fix in the same script: Step 2b already used the temp-file pattern for the protos `package.json` rewrite
- Upstream: Node.js v23 tightened validation of `package.json` files encountered during module resolution startup

---

**Status**: ✅ Production Ready
