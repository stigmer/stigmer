# SDK Acceptance Smoke Tests (Go, TypeScript, Python)

**Date**: May 16, 2026

## Summary

Added SDK acceptance smoke tests that prove all three official SDKs (Go, TypeScript, Python) can communicate with the live Stigmer Cloud Java service end-to-end. These tests catch schema drift, codegen staleness, and serialization mismatches before they reach SDK consumers.

## Problem Statement

The Stigmer platform publishes SDKs in three languages, each with its own codegen pipeline and proto stub embedding. When proto definitions change, any of these SDKs can silently become incompatible with the server if codegen is stale or serialization formats drift.

### Pain Points

- No automated verification that SDK-generated types match the running server
- Schema drift between `apis/stubs/go/` (server) and `sdk/go/proto/` (SDK) is invisible until a user hits it
- TypeScript SDK uses Connect RPC (different serialization path from native gRPC) — no cross-protocol coverage
- Python SDK constructor requires a non-empty API key even in test mode — never tested in the integration suite

## Solution

Three new test functions in the integration suite (`TestSDKAcceptance_Go`, `TestSDKAcceptance_TypeScript`, `TestSDKAcceptance_Python`) each exercise an identical two-tier test contract against the live Java service:

- **Tier 1**: Agent CRUD (Apply, Get, List, Delete) + NOT_FOUND error handling
- **Tier 2**: Workflow execution lifecycle (Apply workflow, Create execution, Poll until COMPLETED, Verify task status)

The Go test runs in-process using the SDK's own types. TypeScript and Python tests run as subprocesses with structured JSON output, orchestrated by the Go harness.

## Implementation Details

- **Go SDK**: Uses `stigmer.NewClient(WithBaseURL, WithInsecure)` with the SDK's own proto types (`sdk/go/proto/...`) — deliberately different from `apis/stubs/go/` to prove the SDK's codegen layer works independently
- **TypeScript SDK**: Uses `createGrpcTransport` from `@connectrpc/connect-node` (native gRPC) via the SDK's `customTransport` option, since the Java service speaks standard gRPC and there's no gRPC-Web proxy in the test harness
- **Python SDK**: Uses `StigmerClient(api_key="test-api-key", insecure=True)` — the dummy key satisfies the SDK's validation while the test-mode server ignores it
- **Caching**: npm install and pip virtualenv setup are cached across runs (mtime comparison on package.json/pyproject.toml)
- **Graceful skips**: tsx/python3 not on PATH skips the respective test; workflow-runner unavailable skips Tier 2

## Benefits

- Catches proto/SDK codegen drift automatically in CI
- Exercises all three serialization paths (native gRPC Go, Connect RPC TypeScript, grpcio Python)
- Tests the SDK's error contract (NOT_FOUND mapping) across all languages
- Runs as part of the existing `make test` target — zero friction for developers
- Convenience target `make test-sdk` for focused development runs

## Impact

- **SDK consumers**: Confidence that published SDKs match the server contract
- **CI pipeline**: Schema drift detected before merge, not after release
- **Developer experience**: `make test-sdk` validates all three SDKs in ~30 seconds

## Related Work

- T18 in the E2E workflow testing infrastructure project (`20260514.01`)
- Integration test harness built in Sessions 1-23
- Go SDK at `sdk/go/`, TypeScript SDK at `sdk/typescript/`, Python SDK at `sdk/python/`

---

**Status**: Production Ready
**Timeline**: 1 session
