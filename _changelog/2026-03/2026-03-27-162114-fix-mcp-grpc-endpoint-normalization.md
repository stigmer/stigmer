# Fix MCP Server gRPC Endpoint Normalization

**Date**: March 27, 2026

## Summary

Fixed a TLS/plaintext protocol mismatch that caused `mcp-server-stigmer` to fail with "connection reset by peer" when `STIGMER_SERVER_ADDRESS` was provided as a bare hostname or URL instead of strict `host:port` format. Added endpoint normalization, config validation warnings, and the missing deployment-level env var for auto-injection.

## Problem Statement

When users configured `STIGMER_SERVER_ADDRESS` with values like `api.stigmer.ai` or `https://api.stigmer.ai`, the MCP server's gRPC client silently used plaintext HTTP/2 against a TLS endpoint, producing an opaque "Stigmer server is unavailable" error.

### Pain Points

- The TLS decision relied on a fragile `strings.HasSuffix(endpoint, ":443")` check that failed for bare hostnames and URL-scheme prefixed values
- Go gRPC's DNS resolver defaults to port 443, so the connection targeted a TLS port but with plaintext credentials
- The agent-runner pod lacked `STIGMER_SERVER_ADDRESS` in its environment, so the auto-injection fallback for MCP subprocesses was silently inoperative
- The error message ("Stigmer server is unavailable") gave no indication that TLS misconfiguration was the root cause

## Solution

Three-layer fix: deployment config, endpoint normalization, and startup validation.

## Implementation Details

### 1. Deployment Config (`backend/services/agent-runner/_kustomize/overlays/prod/service.yaml`)

Added `STIGMER_SERVER_ADDRESS` to the agent-runner pod environment, pointing to the same internal Kubernetes service endpoint used by `STIGMER_BACKEND_ENDPOINT`. This enables the `config_transformer.py` auto-injection to provide the correct internal address to MCP subprocesses as a fallback when users don't set it themselves.

### 2. Endpoint Normalization (`mcp-server/internal/grpc/client.go`)

Introduced `NormalizeEndpoint()` that transforms user-provided addresses into the `host:port` format gRPC expects:

- Strips URL schemes (`https://`, `http://`)
- Removes trailing slashes
- Appends `:443` with TLS for non-loopback hosts that have no explicit port
- Preserves loopback addresses (`localhost`, `127.0.0.1`, `::1`) as insecure
- Logs every normalization with original and resolved values for observability

`NewConnection()` now delegates to `NormalizeEndpoint()` before dialing, so all callers benefit without code changes.

### 3. Config Validation (`mcp-server/internal/config/config.go`)

`Validate()` now emits structured `slog.Warn` messages at startup when `STIGMER_SERVER_ADDRESS` contains a URL scheme or lacks an explicit port. These warnings surface misconfigurations immediately in pod logs without blocking startup.

## Benefits

- Users can provide `STIGMER_SERVER_ADDRESS` in any natural format: `host:port`, `https://host`, or bare `host`
- Misconfigurations are visible at startup through clear warning logs rather than producing opaque runtime errors
- Internal cluster MCP subprocesses get the correct address by default without user intervention
- 15 new test cases covering all normalization paths (URL schemes, bare hostnames, loopback, IPv6, whitespace, trailing slashes)

## Impact

- **MCP server subprocess connectivity**: Eliminates the class of TLS/plaintext mismatch errors that occurred when users provided endpoint values without explicit `:443` suffixes
- **Agent-runner prod deployment**: MCP subprocesses now receive the internal cluster address automatically, reducing configuration burden
- **Observability**: Both startup validation and per-connection normalization produce structured logs that make endpoint resolution transparent

## Related Work

- `2026-03-24-110635-fix-static-export-navigation-and-agent-runner-endpoint.md` — earlier migration of agent-runner to internal endpoints
- `2026-03-26-112124-decouple-mcp-server-from-cli-binary.md` — MCP server extracted as standalone Go binary
- `2026-03-27-134600-mcp-discovery-timeout-and-security-hardening.md` — related MCP subprocess hardening

---

**Status**: Production Ready
