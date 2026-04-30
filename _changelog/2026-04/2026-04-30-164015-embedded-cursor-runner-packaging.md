# Embedded Cursor Runner Packaging (T09)

**Date**: April 30, 2026

## Summary

Implemented embedded packaging for the cursor-runner TypeScript service, mirroring the proven Python agentrunner pattern. The cursor-runner can now be compiled to JavaScript at build time, embedded in the CLI binary via `go:embed`, and bootstrapped at runtime with a managed Node.js download and npm install for platform-specific native dependencies. This completes Phase 3 (CLI Integration) of the Cursor harness project.

## Problem Statement

The cursor-runner TypeScript service (created in T03, wired into the CLI in T05) only worked in dev mode -- requiring system Node.js >= 20 and the source tree on disk. Release CLI binaries could not ship with Cursor harness support because there was no mechanism to embed and bootstrap the TypeScript service.

### Pain Points

- End users needed to install Node.js manually for Cursor harness support
- Release binaries (`stigmer up`) could not start cursor-runner
- No parity with the Python agentrunner, which had full embed/bootstrap support

## Solution

Mirror the Python agentrunner embedding pattern: embed compiled source via `go:embed`, download a managed Node.js runtime at first bootstrap, install platform-specific native dependencies via npm. Created `nodert.Manager` as the Node.js counterpart to `pythonrt.Manager`.

### Critical Discovery: Bun Compile is Not Viable

The original plan assumed `bun build --compile` for standalone binaries. Research revealed that `@temporalio/worker` depends on Node-API native modules, `worker_threads`, `vm`, and `async_hooks` -- all Node.js-specific APIs that Bun does not support. Node.js SEA was also evaluated but rejected due to fragile cross-platform native module handling.

## Implementation Details

### New: `nodert.Manager` (5 files)

Managed Node.js runtime lifecycle, parallel to `pythonrt.Manager`:

- **`manager.go`** -- Core lifecycle: download Node.js, extract app source, npm install, manifest validation. Includes tar.gz extraction with prefix stripping, `copyFS` for embedded source, macOS quarantine clearing, and robust directory cleanup.
- **`platform.go`** -- Platform detection mapping Go's `runtime.GOARCH` to Node.js naming (`amd64` -> `x64`). Download URL construction from nodejs.org official releases.
- **`checksums.go`** -- Pinned Node.js 22.22.2 LTS with SHA-256 checksums for 4 platforms (darwin-arm64, darwin-x64, linux-x64, linux-arm64).
- **`download.go`** -- Download + SHA-256 verification using shared `httputil.DownloadFile`.
- **`manifest.go`** -- Version manifest for cache invalidation (schema version, CLI version, platform, Node.js version, deps lock hash).

### New: `sync.sh` for cursor-runner

Build-time source preparation script (parallel to `agentrunner/sync.sh`): copies TypeScript source, resolves `@stigmer/protos` file: dependency as a local lib, runs `npm install` + `tsc` compilation, strips `node_modules/` and devDependencies for clean embedding.

### New: Dual-mode bootstrap

Both daemon and standalone runner paths now support two modes:
- **Dev mode** (SourceDir != ""): system Node.js + tsx, source from repo tree (T05 flow, unchanged)
- **Embed mode** (SourceFS != nil, SourceDir == ""): managed Node.js + compiled JS via `nodert.Manager`

The `CursorRunnerBootstrapResult` type carries `EntryArgs` so the daemon process knows whether to run tsx (dev) or `node dist/main.js` (embed).

### Build system integration

- Release CLI workflow (`release.cli.yaml`): cursor-runner sync step + `embed_cursorrunner` tag added to all 3 platform jobs
- Desktop release workflow (`release.desktop.yaml`): same additions
- Root Makefile: cursorrunner `devSourceDir` ldflags for `make local` + `source/` cleanup in `make clean`
- Desktop sidecar dev script: cursor-runner sync + embed tag

## Benefits

- **Self-contained CLI binary**: Release builds ship with Cursor harness support, no system Node.js required
- **Consistent UX**: Same bootstrap experience as the Python agentrunner (~60s first run, instant thereafter)
- **Clean architecture**: `nodert.Manager` parallels `pythonrt.Manager` -- easy to maintain and reason about
- **Dev mode preserved**: Developers keep the fast tsx-based iteration loop

## Impact

- **End users**: `stigmer up` with Cursor harness works out of the box on release builds
- **Release pipeline**: 3 CI jobs updated (darwin-arm64, darwin-amd64, linux-amd64) + desktop
- **Binary size**: Minimal increase (~1-5 MB for compiled JS source; Node.js and node_modules are downloaded at runtime)

## Related Work

- T05: CLI Daemon Multi-Worker Management (established dev-mode cursor-runner integration)
- T03: Cursor Runner TypeScript Service (created the service being embedded)
- Python agentrunner embedding (pattern being mirrored)

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
