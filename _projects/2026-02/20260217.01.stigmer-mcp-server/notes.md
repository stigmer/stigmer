# Notes: Stigmer MCP Server

## Project Summary

Build an MCP (Model Context Protocol) server for Stigmer that lets AI coding assistants
(Cursor, Claude Desktop, Windsurf) discover and interact with Stigmer resources.

## Reference Implementation

**mcp-server-planton** at `/Users/suresh/scm/github.com/plantonhq/mcp-server-planton`
- Go + `mark3labs/mcp-go` SDK (v0.6.0) — community SDK
- Supports stdio, HTTP/SSE, and both simultaneously
- Per-user API key auth (Bearer token in HTTP, env var in stdio)
- Domain-based tool organization (commons, infrahub, resourcemanager, servicehub, connect)
- gRPC PerRPCCredentials for auth propagation
- Docker + binary distribution

## Key Decision: Official Go SDK over mcp-go

Stigmer will use `github.com/modelcontextprotocol/go-sdk` (official Anthropic SDK, maintained
with Google) instead of the community `mark3labs/mcp-go` that Planton uses.

**Improvements over Planton's approach:**
- Typed tool handlers (Go structs with `jsonschema` tags) instead of raw `map[string]any`
- Context-based auth in tool handlers (no global mutex store workaround)
- Native `StreamableHTTPHandler` (no custom SSE proxy with internal port rewriting)
- Built-in `auth` and `oauthex` packages for OAuth support
- Full spec conformance testing
- Future-proof — official SDK tracks the spec as it evolves

**Note:** Planton should consider migrating to the official SDK in a future update.

## Language Choice Rationale

- **GitHub's MCP server** (27K stars, most popular MCP server) is Go (95.7%)
- Anthropic's official Go SDK exists: `modelcontextprotocol/go-sdk` (3.9K stars)
- TypeScript dominates by count of community servers, but mainly due to NPX distribution convenience
- For infrastructure/platform tools, Go is the industry standard
- NPX advantage doesn't justify introducing Node.js into an all-Go project
- NPX wrapper for Go binary is possible as a Phase 3 nice-to-have

## NPX Explained

NPX = Node Package Execute. Runs npm packages without installing. Popular for JS MCP servers:
`npx -y @modelcontextprotocol/server-github`. Not applicable for Go directly, but we can
create an npm wrapper that downloads and runs the Go binary if there's demand. Lower priority
— Docker, `go install`, and binary releases serve the same purpose.

## Key Decisions

1. **Repo placement**: Mono repo (`mcp-server/`) — co-located with APIs for atomic updates
2. **Language**: Go + official `modelcontextprotocol/go-sdk`
3. **Transports**: stdio + Streamable HTTP from day one
4. **Auth**: Per-user API keys via Bearer tokens, context-based propagation, gRPC PerRPCCredentials
5. **Phase 1 scope**: Read-only — agents, skills, workflows (list + get)
6. **Distribution**: Binary + Docker first; Homebrew + NPX wrapper later

## Phase Roadmap

| Phase | Resources | Operations | Transport |
|---|---|---|---|
| 1 | Agents, Skills, Workflows | List, Get (read-only) | stdio + HTTP |
| 2 | + MCP Servers, Projects | + Apply, Create, Update, Delete | + Docker deploy |
| 3 | + Executions, Sessions | + Run, Status, Output | + Kubernetes |
| 4 | + Build artifacts | + Prompts, Subscriptions | + NPX wrapper |

## Quick Links

- MCP Spec: https://modelcontextprotocol.io/specification
- Official Go SDK: https://github.com/modelcontextprotocol/go-sdk
- Go SDK docs: https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/mcp
- mcp-go (Planton uses): https://github.com/mark3labs/mcp-go
- GitHub MCP Server (Go reference): https://github.com/github/github-mcp-server
- Planton MCP Server: `/Users/suresh/scm/github.com/plantonhq/mcp-server-planton`
- Stigmer APIs: `apis/ai/stigmer/agentic/` (proto definitions)
- Stigmer gRPC stubs: `apis/stubs/go/`
