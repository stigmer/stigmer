# HTTP/2 Interceptor for Connect RPC Billing — ESM Namespace Workaround

**Date**: May 31, 2026

## Summary

Built a working HTTP/2 interceptor that injects `x-stigmer-execution-id` on Cursor SDK Connect RPC streams. Solved a non-obvious Node.js ESM interop problem where patching `http2.connect` via default imports is invisible to modules using namespace imports (`import * as http2`). Discovered and documented a dual-auth architectural issue that is the sole remaining blocker for proxy-authoritative billing.

## Problem Statement

The Cursor SDK's `@connectrpc/connect-node` transport uses native HTTP/2, completely bypassing `globalThis.fetch`. The existing fetch interceptor (which already injects `x-stigmer-execution-id` on REST calls) has no effect on the BiDi stream. Without the execution ID, the Java BiDi proxy sets `metered=false` and billing is skipped.

### Pain Points

- `connect-node` uses `import * as http2 from "node:http2"` — ESM namespace imports create a frozen binding that does not reflect runtime mutations to the module's exports object
- Default-import-based patching (`import http2 from "node:http2"; http2.connect = ...`) only modifies the CJS exports object, invisible to namespace consumers
- The Cursor SDK provides no extension point (no interceptors, no custom transport, no header injection API)
- HTTP/2 connection multiplexing means the execution ID must be read per-stream (at `request()` time), not per-connection

## Solution

Patch `http2.connect` using `createRequire(import.meta.url)` to obtain the actual CJS module singleton. Mutations via `require()` ARE visible to subsequent ESM namespace imports because Node.js builtins expose a shared singleton. The interceptor wraps sessions targeting the proxy endpoint, injecting the execution ID from AsyncLocalStorage on each stream.

## Implementation Details

### Key Technical Discovery: ESM Namespace Freeze

```
import http2 from "node:http2";       // ← CJS exports object (mutable)
import * as http2ns from "node:http2"; // ← frozen namespace (ignores mutations)

http2.connect = patched;
http2ns.connect === patched; // FALSE — namespace is a snapshot
```

Fix: Use `createRequire()` which modifies the same singleton that ESM namespace getters delegate to when the module is loaded AFTER the patch.

### Architecture

- `http2-interceptor.ts` — CJS-patched `http2.connect`, wraps sessions for proxy authority, injects `x-stigmer-execution-id` + `authorization` per-stream from ALS
- Wired in `runner.ts` and `runner-manager.ts` before `@cursor/sdk` is imported
- Shares `AsyncLocalStorage` with the fetch interceptor via `getExecutionContext()`
- 17 unit tests covering: injection, no-context passthrough, non-proxy passthrough, connection reuse, authority parsing

### Dual-Auth Blocker (Unresolved)

The BiDi proxy's `AuthenticationManager` validates Cursor access tokens. For billing, FGA needs a Stigmer JWT. Sending the Stigmer JWT as `authorization` causes auth rejection. Recommended solution: dedicated `x-stigmer-auth` header carrying the Stigmer JWT alongside the existing Cursor `authorization`.

## Benefits

- Execution ID now reaches the Java proxy on every Connect RPC stream (verified via integration test)
- Pattern is composable — same `createRequire` trick works for any ESM-consumed builtin patch
- Clean install/uninstall lifecycle enables testing without process restart

## Impact

- **Runner**: New module + wiring in both runner modes
- **Integration tests**: Confirmed header propagation end-to-end (runner → Go proxy → Java service)
- **Blocking for billing**: Once dual-auth is resolved, `metered=true` will flow and `ProxyUsageReporter` will emit billing records

## Related Work

- Session 6: Gzip decompression fix for `ConnectCursorUsageExtractor`
- Session 5: Path routing, `CURSOR_BACKEND_URL` discovery, BiDi stream relay
- `_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/next-task.md` — full project context

---

**Status**: In Progress (dual-auth blocker remaining)  
**Timeline**: Session 7 of multi-session project
