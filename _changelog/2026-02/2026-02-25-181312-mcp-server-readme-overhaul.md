# MCP Server README Overhaul

**Date**: February 25, 2026

## Summary

Rewrote the MCP server README from scratch to be architecturally accurate,
contractually complete, and contributor-ready. Fixed a confirmed bug where the
default `STIGMER_SERVER_ADDRESS` was `localhost:9090` instead of matching
stigmer-server's actual default port of `7234`.

## Problem Statement

The existing README documented *how to install* the MCP server but not *what it
is* or *why it exists*. A Principal Software Architect review identified nine
categories of gaps ranging from missing architectural context to silently broken
Docker examples.

### Pain Points

- No architectural overview explaining the stateless MCP-to-gRPC gateway design
- No glossary defining domain terms (org, slug, apply, stigmer:// URI)
- Tool reference was a one-liner table with no parameter documentation
- The `apply_skill` tool's intentional absence was undocumented, appearing as a
  documentation bug
- Docker client config examples used `localhost` which silently fails inside
  containers
- The env vars table listed the wrong default port (`9090` instead of `7234`)
- The config code also had the wrong default, meaning users who relied on the
  fallback would connect to the wrong port
- HTTP mode section lacked transport protocol, auth token, and TLS details
- No development section for contributors (make targets, codegen pipeline,
  domain package pattern)
- License was vague ("available under the same license") instead of explicit

## Solution

Complete rewrite of `mcp-server/README.md` with 10 well-defined sections, plus
a targeted code fix to align the default port with stigmer-server's actual
configuration.

## Implementation Details

### README Structure (10 sections)

1. **Overview** -- stateless gateway description + ASCII architecture diagram
2. **Key Concepts** -- glossary table defining org, slug, agent, skill,
   workflow, MCP server, apply, and the stigmer:// URI scheme
3. **Installation** -- four install methods with Docker networking callout
4. **MCP Client Configuration** -- config blocks for all clients, explicit
   VS Code example with `"servers"` key
5. **Configuration Reference** -- corrected env vars table with TLS behavior
   note
6. **Tools** -- per-tool parameter tables, search usage patterns, "Why no
   apply_skill?" section, error handling table
7. **Resources** -- URI scheme structure, kind-to-path mapping, MIME types,
   resource_uri workflow
8. **HTTP Mode** -- Streamable HTTP transport, auth details, dual transport,
   TLS guidance
9. **Development** -- make targets, two-stage codegen pipeline, domain package
   pattern, Docker build instructions
10. **License** -- Apache License 2.0 with link

### Code Fix

Changed `STIGMER_SERVER_ADDRESS` default from `localhost:9090` to
`localhost:7234` in:

- `mcp-server/internal/config/config.go` (default value + doc comments)
- `mcp-server/pkg/mcpserver/config.go` (doc comments)
- All test files asserting the old default (3 test files, ~15 assertions)

### Files Changed

- `mcp-server/README.md` (complete rewrite)
- `mcp-server/internal/config/config.go`
- `mcp-server/internal/config/config_test.go`
- `mcp-server/pkg/mcpserver/config.go`
- `mcp-server/pkg/mcpserver/config_test.go`
- `mcp-server/pkg/mcpserver/run_test.go`

## Benefits

- New contributors can understand the architecture without reading source code
- MCP client consumers have per-tool parameter documentation instead of
  guessing from tool names
- The skill read-only asymmetry is explicitly documented, preventing confusion
- Docker users get a working configuration on first try
- The default port now matches stigmer-server, eliminating silent connection
  failures for users relying on defaults

## Impact

- **MCP server users**: Clearer onboarding, fewer configuration errors
- **Contributors**: Development workflow documented (make targets, codegen,
  domain pattern)
- **Operators**: HTTP mode deployment guidance, TLS and auth recommendations

## Related Work

- [MCP Server Scaffolding](2026-02-18-124027-mcp-server-stigmer-scaffolding.md)
- [MCP Server Resource Templates](2026-02-18-160901-mcp-server-readme-and-resource-templates.md)
- [MCP Server Write Operations](2026-02-19-210420-mcp-server-write-operations.md)
- [MCP Server Input Type Codegen](2026-02-20-181518-mcp-server-input-type-codegen.md)

---

**Status**: Production Ready
