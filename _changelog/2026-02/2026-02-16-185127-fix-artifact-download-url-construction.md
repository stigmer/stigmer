# Fix: Artifact Download URL Construction and HTTP File Server

**Date**: February 16, 2026

## Summary

Fixed a critical bug in artifact download flow caused by three compounding issues (missing HTTP scheme, triple path duplication, Docker-internal hostname leaking) plus missing HTTP file server infrastructure. Artifacts published by agents after execution now download successfully via the CLI. The fix adds a lightweight HTTP file server to stigmer-server for serving local artifacts on port 7235.

## Problem Statement

When executing `stigmer draft skill` with approval policies enabled, the agent would successfully write files and publish artifacts, but the CLI would fail with:

```
Get "host.docker.internal:7234/api/v1/artifacts/artifacts/artifacts/aex-01khk62ndpz2ryvenwg0bzzdgx/agent-drafter.zip": unsupported protocol scheme "host.docker.internal"
```

The error revealed multiple architectural issues in the artifact download infrastructure.

### Pain Points

1. **Missing HTTP scheme**: Download URLs lacked `http://` prefix, causing `http.Get()` to fail immediately with scheme parsing errors
2. **Triple path duplication**: The URL path contained `/artifacts/artifacts/artifacts/` due to three layers each contributing an `artifacts/` segment (base URL, Python URL builder, storage key)
3. **Docker-internal hostname leak**: URLs generated inside the agent-runner container (using `host.docker.internal`) were cached in execution status and returned to CLI clients on the host, causing connection failures
4. **No HTTP file server**: The entire URL-generation infrastructure assumed an HTTP file server existed, but stigmer-server only ran a gRPC server on port 7234 — nothing actually served the artifact files

## Solution

Implemented a comprehensive fix addressing all four issues:

1. **Add HTTP scheme**: Updated daemon.go and supervisor.go to include `http://` in `LOCAL_ARTIFACT_SERVE_URL`
2. **Remove path duplication**: Fixed Python `local.py` to not add `/artifacts/` prefix (aligns with Go's existing behavior), removed `/api/v1/artifacts` suffix from base URL
3. **CLI always refreshes URLs**: Modified CLI download handlers to always call `GetArtifactDownloadUrl` gRPC method instead of using cached URLs, ensuring host-appropriate URLs (localhost) are used
4. **Add HTTP file server**: Implemented lightweight HTTP file server in stigmer-server that serves local artifacts on port 7235 (GRPCPort + 1)

## Implementation Details

### 1. HTTP File Server (`backend/services/stigmer-server/pkg/server/server.go`)

Added HTTP file server that starts alongside gRPC server for local storage mode:

```go
if cfg.ArtifactStorage.Type == "local" {
    artifactDir := filepath.Join(cfg.ArtifactStorage.LocalBasePath, "artifacts")
    mux := http.NewServeMux()
    mux.Handle("/", http.FileServer(http.Dir(artifactDir)))
    addr := fmt.Sprintf("127.0.0.1:%d", cfg.ArtifactHTTPPort)
    go func() {
        if err := http.ListenAndServe(addr, mux); err != nil && err != http.ErrServerClosed {
            log.Error().Err(err).Msg("Artifact HTTP file server failed")
        }
    }()
}
```

- Binds to `127.0.0.1` only (not externally accessible)
- Serves from `{basePath}/artifacts/` directory
- Default port: 7235 (configurable via `ARTIFACT_HTTP_PORT`)

### 2. Configuration (`backend/services/stigmer-server/pkg/config/config.go`)

- Added `ArtifactHTTPPort` field (env: `ARTIFACT_HTTP_PORT`, default: `GRPCPort + 1`)
- Changed `ARTIFACT_LOCAL_SERVE_URL` default from `http://localhost:8080/artifacts` to `http://localhost:7235` (no trailing path)

### 3. Python URL Construction (`backend/services/agent-runner/worker/storage/local.py`)

Changed line 117 from:
```python
return f"{self.serve_url_base}/artifacts/{key}"
```

To:
```python
return f"{self.serve_url_base}/{key}"
```

The storage key already contains `artifacts/` prefix (e.g., `artifacts/{exec_id}/{file}`), so adding another `/artifacts/` created duplication. This aligns Python with Go's `local_storage.go:74` which already does `fmt.Sprintf("%s/%s", s.serveURL, key)`.

### 4. Agent-Runner Environment Variables

**daemon.go** (line 615):
```go
"-e", fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=http://%s:%d", resolveDockerHostAddress("localhost"), DaemonPort+1),
```

**supervisor.go** (line 306):
```go
artifactHTTPPort := s.config.ArtifactHTTPPort
if artifactHTTPPort == 0 {
    artifactHTTPPort = s.config.StigmerServerPort + 1
}
artifactHost := s.resolveDockerHostAddress("localhost")
"-e", fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=http://%s:%d", artifactHost, artifactHTTPPort),
```

Changes:
- Added `http://` scheme
- Use artifact HTTP port (7235) instead of gRPC port (7234)
- Removed `/api/v1/artifacts` path suffix (no longer needed)

### 5. CLI Always Refreshes URLs

**run_handlers.go** and **download_execution.go**:
```go
// Always refresh the download URL via gRPC. The cached URL in the execution
// status may use a Docker-internal hostname (host.docker.internal) that is
// inappropriate for CLI-side HTTP requests. The server generates a fresh URL
// using the host-appropriate base address (e.g., localhost).
downloadURL, _, err := execution.GetArtifactDownloadURL(conn, executionID, artifact.GetStorageKey())
if err != nil {
    // Fall back to cached URL if gRPC refresh fails
    downloadURL = artifact.GetDownloadUrl()
    if downloadURL == "" {
        return errors.Wrap(err, "failed to get download URL")
    }
}
```

Previously, the CLI used cached URLs unless they were expired. Now it always refreshes via gRPC to get a host-appropriate URL (with `localhost` instead of `host.docker.internal`).

### 6. Test Coverage

Created `backend/services/agent-runner/tests/test_local_storage.py` with 10 tests:

**URL Construction Tests**:
- `test_url_uses_key_directly`: Verifies `{base}/{key}` format
- `test_url_no_double_artifacts`: Ensures no path duplication
- `test_trailing_slash_stripped_from_base`: Base URL normalization
- `test_docker_internal_host`: Docker hostname support
- `test_expires_in_ignored`: Local URLs don't expire

**Storage Tests**:
- `test_upload_and_download`: Round-trip verification
- `test_download_nonexistent_raises`: Error handling
- `test_exists`: File existence checking
- `test_delete`: File deletion
- `test_delete_nonexistent_is_idempotent`: Deletion idempotency

All tests pass. Existing test suite (17 auto-publish tests, 173 status builder tests) continues to pass.

## Benefits

1. **Artifacts Now Download**: The primary user flow (`stigmer draft skill` with approval policies) works end-to-end
2. **Correct URL Format**: URLs are well-formed with scheme, appropriate hostname, and correct path structure
3. **Clean Architecture**: HTTP file server is lightweight, secure (localhost-only), and properly separated from gRPC server
4. **Better Resilience**: CLI falls back to cached URLs if gRPC refresh fails
5. **Well-Tested**: 10 new tests provide regression protection for URL construction logic

## Impact

### User-Facing

- **`stigmer draft skill`** and other artifact-producing commands now successfully download files after approval cycles
- No misleading "No skill artifacts were generated" warnings for successful executions
- Users can run the platform in local/OSS mode without external artifact storage

### Developer-Facing

- HTTP file server provides clear separation of concerns (gRPC for control plane, HTTP for data plane)
- URL construction is consistent between Python and Go implementations
- New tests make URL format expectations explicit

### Technical

- Fixes fundamental infrastructure gap — artifact storage layer now has matching retrieval layer
- Port 7235 is now the canonical artifact HTTP port (configurable via `ARTIFACT_HTTP_PORT`)
- Docker-internal URLs stay internal; host-facing URLs use localhost

## Related Work

- **Fix: Artifacts Not Downloaded After Approval Resume** (2026-02-16-174323) — Fixed run-ID alias resolution in status builder to transition tool calls to COMPLETED, enabling auto-publish to detect written files
- **Fix: HITL Approval Stream Race Condition** (2026-02-16-165045) — Fixed stream continuation logic for approval interrupts
- This fix completes the artifact download pipeline by providing the missing HTTP file server and fixing URL construction

---

**Status**: ✅ Production Ready  
**Timeline**: Identified and fixed in ~3 hours (investigation + implementation + testing)
