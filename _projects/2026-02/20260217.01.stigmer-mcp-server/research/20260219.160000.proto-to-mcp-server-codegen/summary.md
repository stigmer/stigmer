# Proto-to-MCP Server Codegen - Research Summary

**Date:** February 19, 2026
**Source:** ChatGPT Deep Research
**Verdict:** Solved — existing open-source tools cover the core problem; resource template generation is the only gap.

---

## Key Finding

You do NOT need to build a proto-to-MCP generator from scratch. The ecosystem has multiple production-used tools, with Redpanda's `protoc-gen-go-mcp` being the most complete.

## Tool Inventory

### Proto-First Code Generators (compile-time)

| Tool | Stars | Language | Status | Best For |
|---|---|---|---|---|
| `redpanda-data/protoc-gen-go-mcp` | 186 | Go | Production-used by Redpanda Cloud | Drop-in Buf plugin, gRPC/Connect client forwarding, JSON Schema generation |
| `Loschcode/grpc-mcp-gateway` | Low | Go | Early | Proto annotations control tool metadata (name, description, read-only hints) |
| `stablekernel/protoc-gen-ts-mcp` | Low | TypeScript | Early | TypeScript MCP servers from proto |
| `stablekernel/protoc-gen-rust-mcp` | Low | Rust | Early | Rust MCP servers from proto |
| `kevkongmc/protoc_gen_mcp` | Low | Python | POC | Python MCP proxy from proto |

### Runtime Reflection Bridges (zero codegen)

| Tool | Stars | Approach | Status |
|---|---|---|---|
| `adiom-data/grpcmcp` | 27 | Reflection or descriptor set proxy | Simple, good for experimentation |
| `aalobaidi/ggRMCP` | Low | Reflection gateway with filtering | Experimental |
| `wricardo/grpcurl-mcp` | Low | Shells out to grpcurl | Quick-and-dirty |

### OpenAPI-to-MCP Generators (mature alternative path)

| Tool | Stars | Notes |
|---|---|---|
| AWS Labs OpenAPI MCP Server | High | Dynamic tool creation from OpenAPI 3.x |
| `cnoe-io/openapi-mcp-codegen` | — | Python MCP server codegen from OpenAPI |
| `mattt/emcee` | — | Homebrew-installable OpenAPI-to-MCP bridge |

## Recommendation: Two-Track Strategy

### Track 1: Adopt `protoc-gen-go-mcp` for tool generation (immediate)

- Covers: tool definitions, JSON Schema input, gRPC client forwarding, response serialization
- Integrates with Buf pipeline (add to `buf.gen.yaml`)
- Replaces ~120-230 lines of hand-written boilerplate per resource domain
- Currently targets `mcp-go` (Planton compatible today; Stigmer needs minor SDK adjustment)

### Track 2: Build a thin layer for resource URI templates (if needed)

- No existing tool generates MCP resource templates from proto
- Options: (a) extend `protoc-gen-go-mcp` with resource template support, (b) build a small manifest-driven generator for just the resource layer, (c) drop resources and use tools-only (acceptable UX)

## Gaps in Existing Tools

| Gap | Impact | Workaround |
|---|---|---|
| No resource template generation | Lose `stigmer://agents/{org}/{slug}` browsable URIs | Tools-only UX; or thin custom layer |
| `protoc-gen-go-mcp` targets `mcp-go`, not official Go SDK | Stigmer uses official SDK | Switch SDK, or wait for planned migration |
| No interceptor support in `protoc-gen-go-mcp` | Can't add middleware to generated handlers | Handle auth/logging at transport layer |
| Tool naming from RPC method names may not match desired MCP conventions | e.g., `AgentQueryController_GetByReference` vs `get_agent` | Customize via proto options or post-generation |

## Impact Across Products

| Product | Immediate Action |
|---|---|
| Planton | Drop-in: already uses `mcp-go`. Add plugin to Buf pipeline, replace hand-written domains. |
| Stigmer | Evaluate SDK swap to `mcp-go`, or keep custom server for search/URI enrichment and use generated code for get/apply/delete tools. |
| Future products | Zero per-product MCP work once plugin is in Buf pipeline. |

---

_Summary generated: February 19, 2026_
_Full report: `04.report.gpt.md`_
