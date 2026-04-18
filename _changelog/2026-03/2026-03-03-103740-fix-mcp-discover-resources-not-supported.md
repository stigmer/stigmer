# Fix MCP Discovery Crash When Server Doesn't Support Resources

**Date**: March 3, 2026

## Summary

Fixed `stigmer discover mcp-server` crashing with "Resources not supported" when the target MCP server doesn't advertise the Resources capability. The discovery flow now checks server capabilities before attempting to list resource templates.

## Problem Statement

Running `stigmer discover mcp-server planton` failed with:

```
Error: discovery failed for MCP server 'planton': failed to list resource templates:
  calling "resources/templates/list": Resources not supported
```

### Pain Points

- MCP servers that only expose tools (no resources) could not be discovered at all
- The error was confusing — it implied the server was misconfigured rather than the client being too eager
- Blocked onboarding of any tool-only MCP server (e.g., planton)

## Solution

Check `session.InitializeResult().Capabilities.Resources` before calling `listAllResourceTemplates`. If the server didn't advertise resource support during the MCP handshake, skip the resource template listing and return an empty slice instead of crashing.

## Implementation Details

**File**: `backend/libs/go/mcpdiscovery/discover.go`

The MCP protocol's `initialize` response includes a `ServerCapabilities` struct. The `Resources` field is `nil` when a server doesn't support resources. The go-sdk enforces this — calling `session.ResourceTemplates()` on a server without resource capability returns an error.

The fix wraps the resource template listing in a capability check:

```go
var templates []*mcp.ResourceTemplate
if caps := session.InitializeResult().Capabilities; caps != nil && caps.Resources != nil {
    templates, err = listAllResourceTemplates(ctx, session)
    // ...
}
```

`ConvertResourceTemplates` already handles nil/empty input, so no changes needed downstream.

## Benefits

- Tool-only MCP servers (like planton) can now be discovered successfully
- Aligns with MCP protocol semantics — capability negotiation is respected
- No behavior change for servers that do support resources

## Impact

- **CLI**: `stigmer discover mcp-server` now works for all MCP servers regardless of capability set
- **Bootstrap**: Auto-discovery during `stigmer apply` no longer fails for tool-only servers
- **Shared library**: Fix is in `mcpdiscovery` which is used by both CLI and backend flows

## Related Work

- [2026-03-03-103119] Add --env flag to discover mcp-server
- [2026-03-03-100453] MCP tool error resilience
- [2026-03-03-094036] Fix MCP client breaking API change

---

**Status**: ✅ Production Ready
