# Design Decision: Embedded Cursor Runner Packaging Strategy

**Date**: 2026-04-30
**Task**: T09 -- Embedded Cursor Runner Packaging
**Status**: DECIDED -- Mirror Python agentrunner pattern (managed Node.js + npm install)

## Context

T05 established cursor-runner as an optional second worker alongside the Python agent-runner.
In dev mode it works with system Node.js + tsx. T09 makes it work in embed mode so that
release CLI binaries ship with Cursor harness support -- no user-installed Node.js required.

The original T01 plan assumed `bun build --compile` would produce a single standalone binary.

## Options Evaluated

### Option A: `bun build --compile` (REJECTED)

Bun supports cross-compilation via `--target` (darwin-arm64, linux-x64, etc.) and produces
standalone executables with the Bun runtime embedded.

**Why it fails**: The Temporal TypeScript Worker SDK (`@temporalio/worker`) depends on:

- **Node-API native modules** -- Core SDK Rust bindings loaded via `process.dlopen()`
- **`worker_threads`** -- Workflow execution isolation
- **`vm` modules** -- Workflow sandbox
- **`async_hooks` / `AsyncLocalStorage`** -- Context propagation and stack traces

Temporal officially states that running workers in Bun is unsupported. Community issues
(temporalio/sdk-typescript#1334, #1618) confirm runtime failures. A third-party
`@proompteng/temporal-bun-sdk` exists but is not production-grade.

### Option B: Node.js SEA (Single Executable Application) (REJECTED)

Node.js v25.5.0 introduced `--build-sea` for streamlined SEA creation.

**Why it fails for us**:

- Cross-compilation requires building on each target platform (no cross-build support)
- `useCodeCache` and `useSnapshot` must be disabled for cross-platform builds
- Native modules (Temporal Core SDK `.node` files) must be extracted to disk at runtime
  and loaded via `process.dlopen()` -- fragile and platform-specific
- Significantly more complex CI pipeline for marginal benefit

### Option C: Mirror Python agentrunner pattern (CHOSEN)

Embed compiled JavaScript source in the Go binary via `go:embed`. At first bootstrap,
download an official Node.js binary and run `npm install` for platform-specific native
dependencies. Cache everything under `~/.stigmer/runtimes/cursor-runner/`.

## Decision

**Mirror the Python agentrunner pattern exactly.**

| Aspect | Python agentrunner | Node.js cursor-runner |
|--------|-------------------|----------------------|
| Source embedding | `sync.sh` copies `.py` + libs | `sync.sh` compiles `.ts` to `.js` + copies protos |
| go:embed | `//go:embed all:source` | Same |
| Runtime download | python-build-standalone | Official Node.js 22 LTS from nodejs.org |
| Dep install | `pip install -r requirements.txt` | `npm install` (package-lock.json) |
| Runtime manager | `pythonrt.Manager` | `nodert.Manager` (new, parallel API) |
| Version isolation | `<base>/<cliVersion>/<platform>/` | Same |
| Execution | `<venv>/bin/python main.py` | `<node>/bin/node dist/main.js` |

### Build-time: `sync.sh`

1. Copy cursor-runner TypeScript source into `embedded/cursorrunner/source/`
2. Copy `@stigmer/protos` TS stubs as a local lib (resolves `file:` dependency)
3. Run `npm install` + `tsc` to compile TypeScript to JavaScript (`source/dist/`)
4. Remove `node_modules/` (will be reinstalled on the target platform for correct native binaries)
5. Strip devDependencies from embedded `package.json`

### Runtime: `nodert.Manager`

1. Check manifest -- if valid for current CLI version, skip bootstrap (instant start)
2. Download official Node.js 22 LTS tarball for the detected platform
3. Extract embedded source to `~/.stigmer/runtimes/cursor-runner/<version>/<platform>/app/`
4. Run `npm install` using the managed Node.js (downloads platform-correct native modules)
5. Write manifest with CLI version, Node.js version, deps lock hash

### Dev mode preserved

Dev mode (build without `embed_cursorrunner` tag) continues to use system Node.js + tsx,
running TypeScript directly from the repo tree. No changes to the T05 dev flow.

## Node.js Version: 22 LTS

Pinned to Node.js 22.x LTS because:

- Cursor SDK requires Node.js >= 20
- 22 is the current Active LTS (supported through April 2027)
- Official pre-built binaries available for all target platforms
- `fetch()` is stable (required for the proxy interceptor pattern)

## Tradeoffs

### Accepted

- **First bootstrap requires network** (~60s to download Node.js + npm install).
  Same tradeoff as the Python runtime -- subsequent starts are instant.
- **Binary size increase** is minimal: only compiled JS source is embedded (~1-5 MB),
  not the Node.js runtime or node_modules.
- **npm registry dependency** at first bootstrap. Same as pip/PyPI for Python.

### Mitigated

- **Node.js download reliability**: Official nodejs.org CDN is highly available.
- **macOS quarantine**: Same `xattr -dr com.apple.quarantine` pattern as Python.
- **Platform-specific native modules**: Handled naturally by npm install on the target.

## Comparison with Original Plan

| Original plan | Actual |
|--------------|--------|
| `bun build --compile` standalone binary | Not viable (Temporal native modules) |
| Zero runtime dependencies | Managed Node.js download (same pattern as Python) |
| Cross-compile from single host | Platform-specific npm install at runtime |
| ~0s bootstrap | ~60s first bootstrap, instant thereafter |
