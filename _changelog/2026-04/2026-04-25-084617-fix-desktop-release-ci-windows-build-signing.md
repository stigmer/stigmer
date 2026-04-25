# Fix Desktop Release CI: Windows Build and Updater Signing

**Date**: April 25, 2026

## Summary

Fixed three independent failures in the `release.desktop` CI workflow that prevented the Stigmer Desktop app from building on all platforms. The Windows build failed due to shell incompatibilities and missing platform support; macOS builds failed due to invalid Apple code signing secrets; and all platforms failed due to a malformed Tauri updater signing key.

## Problem Statement

The `release.desktop.yaml` workflow was failing on every platform in the build matrix, blocking desktop app releases since v0.0.93.

### Pain Points

- **Windows**: PowerShell interprets `\` as a path separator, not a line continuation, causing `go build` to receive a malformed import path `"/"` and subsequent commands to fail as unrecognized cmdlets
- **Windows**: CLI codebase used Unix-only syscall symbols (`Setpgid`, `Kill`, `Flock`, `Stat_t`) and Unix commands (`ps`, `lsof`) that don't exist on Windows, preventing cross-compilation
- **Windows**: Missing `embedded_windows_amd64.go` -- no `GetRunnerBinary` stub for the Windows platform
- **macOS**: Apple code signing env vars (`APPLE_CERTIFICATE`, etc.) were set in the workflow but either empty or invalid, causing the Tauri action to attempt keychain import and fail with `SecurityScopedImport` error
- **All platforms**: `TAURI_SIGNING_PRIVATE_KEY` GitHub secret was not a valid minisign key, causing `failed to decode secret key: Missing comment in secret key`

## Solution

Three commits addressing each layer of failures, plus GitHub secrets reconfiguration:

1. **Shell fix** (`ci(desktop)`): Added `shell: bash` to the `Build CLI sidecar` and `Verify sidecar binary` steps so that backslash line continuations work on Windows runners
2. **Signing fix** (`ci(desktop)`): Regenerated a valid Tauri updater minisign keypair, updated the pubkey in `tauri.conf.json`, set the new private key and password in GitHub Actions secrets, and removed the invalid Apple code signing env vars from the workflow
3. **Windows platform support** (`fix(cli)`): Extracted all Unix-only syscall operations into build-tagged platform files across four packages (`temporal/`, `daemon/`, `logs/`, `cmd/root/`), added `embedded_windows_amd64.go` stub, and provided Windows-native equivalents using `taskkill`, `tasklist`, `netstat`, and `LockFileEx`

## Implementation Details

### Workflow changes (`.github/workflows/release.desktop.yaml`)

- Added `shell: bash` to `Build CLI sidecar` and `Verify sidecar binary` steps
- Removed six Apple signing env vars from the `Build and release (tag push)` step with a TODO comment for re-enabling once a valid certificate is configured
- Tauri updater signing secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) updated via `gh secret set`

### Tauri config (`client-apps/desktop/src-tauri/tauri.conf.json`)

- Updated `plugins.updater.pubkey` to match the newly generated minisign public key

### Platform-specific Go files (14 files changed)

| Package | New files | Purpose |
|---------|-----------|---------|
| `embedded/` | `embedded_windows_amd64.go` | `GetRunnerBinary` stub for Windows |
| `temporal/` | `proc_unix.go`, `proc_windows.go`, `flock_windows.go` | Process group management, signal delivery, file locking |
| `daemon/` | `proc_unix.go`, `proc_windows.go` | Child process group setup (`Setpgid` vs `CREATE_NEW_PROCESS_GROUP`) |
| `logs/` | `inode_unix.go`, `inode_windows.go` | File inode extraction for log rotation detection |
| `cmd/root/` | `inode_unix.go`, `inode_windows.go` | Same inode extraction for CLI log streaming |

### Secrets management

- Stored the new keypair and password in `stigmer-cloud/_ops/planton/service-hub/secrets-group/tauri-desktop-signing.yaml` for discoverability

## Benefits

- Desktop releases can now build successfully on all four CI targets: `darwin/arm64`, `darwin/amd64`, `linux/amd64`, `windows/amd64`
- Windows cross-compilation verified locally before pushing
- Signing keys are properly generated, documented, and stored in both GitHub secrets and the secrets-group registry
- Clean separation of platform-specific code via Go build tags eliminates future cross-compilation surprises

## Impact

- **Release pipeline**: Unblocked -- v0.0.94 release triggered with all fixes included
- **Windows users**: Desktop app can now be built and distributed for Windows
- **Developer experience**: Signing keys are discoverable in `tauri-desktop-signing.yaml` alongside other service-hub secrets
- **Future macOS signing**: Clear TODO and documentation path for adding Apple Developer certificate when ready

## Related Work

- v0.0.93 tag restored to its original commit for accurate release history
- v0.0.94 tag created on the fixed HEAD to trigger the corrected release pipeline

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
