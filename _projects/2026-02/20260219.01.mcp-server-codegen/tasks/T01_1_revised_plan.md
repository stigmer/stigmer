# Task T01 (Revised): Shared Abstractions — Replacing Code Generation with Reusable Helpers

**Created**: 2026-02-20
**Supersedes**: T01_0_plan.md (manifest-driven code generator)
**Status**: PENDING REVIEW
**Type**: Refactoring / Architecture

> **This plan requires your review before execution.**

## Why We Changed Direction

The original plan proposed a standalone YAML manifest + Go template code generator. After researching how established products handle this and analyzing the actual codebase, we concluded:

1. **GitHub's MCP server (40+ tools, 110 contributors, v0.30.3)** is entirely hand-written — no code generation. They invested in runtime abstractions (Toolsets, Inventory) to organize tools, not generate them.

2. **Speakeasy (50+ production MCP servers)** generates from OpenAPI specs, not custom manifests. Their key lesson: the hard work is curating descriptions and pruning tools, not eliminating boilerplate.

3. **The YAML manifest duplicates proto** — RPC names, field names, and types already exist in proto files. A separate YAML creates a synchronization burden that grows linearly with resources.

4. **The boilerplate is modest** — ~250-280 lines per domain. A codegen system (separate repo, templates, manifest parsing, golden tests) would be more code to maintain than the boilerplate it eliminates.

5. **The pattern is still evolving** — write operations (T11-A) aren't finalized. Building a generator for a pattern that's still forming means constant generator updates.

6. **Stigmer and Planton use different SDKs** — Stigmer uses `modelcontextprotocol/go-sdk`, Planton uses `mark3labs/mcp-go`. A "universal" codegen would need to abstract over SDK differences, adding complexity for questionable benefit.

### The Alternative: Shared Abstractions

Instead of generating code, we invest in **reusable Go helpers** in the existing `domains` package that eliminate the mechanical parts of each domain while keeping the curated parts hand-written. This:

- Has zero external dependencies (no separate repo, no YAML, no templates)
- Gives compile-time type safety (Go code references proto stubs directly)
- Keeps curated tool descriptions right next to the implementation
- Is incrementally adoptable (refactor one domain at a time)
- Works immediately (no "build the generator first" blocker)

## Analysis: What's Actually Duplicated

After reading every line across all 4 domains, here's what's mechanical vs. curated:

### Mechanical (identical pattern, different types)

| Pattern | Lines/domain | Description |
|---|---|---|
| gRPC connection + auth + timeout | 7 lines × 3-4 functions | Repeated in every Fetch, Delete, Apply |
| CallToolResult wrapping | 5 lines × 3 handlers | `return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil` |
| ResourceHandler body | 12 lines | Parse URI → call Fetch → wrap in ReadResourceResult |
| Delete two-step pattern | 15 lines | GetByReference → extract ID → Delete RPC |
| Apply pattern | 10 lines | Unmarshal → connect → call Apply → marshal result |

**Total mechanical per standard domain: ~100-120 lines** (out of ~280)

### Curated (must stay hand-written)

| What | Why it's curated |
|---|---|
| Tool names | `get_agent`, `apply_workflow` — product-level naming |
| Tool descriptions | LLM-optimized text, different per tool |
| Input struct field descriptions | Contextual hints for the LLM (`"e.g. code-reviewer"`) |
| Apply input description | Resource-specific JSON schema guidance |
| Resource template metadata | URI pattern, title, description |
| Proto client constructor | Type-specific: `agentv1.NewAgentQueryControllerClient` |
| ID type for delete | Varies: `AgentId{Value:}` vs `ApiResourceDeleteInput{ResourceId:}` |
| Error descriptions | `"agent %q in org %q"` vs `"MCP server %q in org %q"` |

**Total curated per domain: ~150-160 lines** — this stays hand-written regardless.

## Proposed Abstractions

### 1. `WithConnection` — Eliminate gRPC Boilerplate

Every `Fetch`, `Delete`, and `Apply` function opens a connection, sets up auth and timeout, then does one or two RPC calls. This helper handles the ceremony:

```go
// domains/grpchelper.go

// WithConnection creates an authenticated gRPC connection with timeout,
// passes it to fn, and ensures cleanup. This eliminates the 7-line
// connect/auth/timeout/defer pattern repeated in every domain function.
func WithConnection(ctx context.Context, serverAddress string,
    fn func(ctx context.Context, conn *grpc.ClientConn) (string, error),
) (string, error) {
    conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
    if err != nil {
        return "", err
    }
    defer conn.Close()

    rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
    defer cancel()

    return fn(rpcCtx, conn)
}
```

### 2. `TextResult` — Eliminate CallToolResult Wrapping

Every tool handler ends with the same 3-line result construction:

```go
// domains/toolhelper.go

func TextResult(text string) (*mcp.CallToolResult, any, error) {
    return &mcp.CallToolResult{
        Content: []mcp.Content{&mcp.TextContent{Text: text}},
    }, nil, nil
}
```

### 3. `NewResourceHandler` / `NewVersionedResourceHandler` — Resource Handler Factories

Resource handlers follow an identical pattern: parse URI → call Fetch → wrap result. The only differences are the domain name (for errors) and whether to parse a version segment:

```go
// domains/resourcehelper.go

type FetchFunc func(ctx context.Context, serverAddr, org, slug string) (string, error)
type VersionedFetchFunc func(ctx context.Context, serverAddr, org, slug, version string) (string, error)

// NewResourceHandler creates a standard resource handler that parses org/slug
// from the request URI and delegates to fetchFn.
func NewResourceHandler(fetchFn FetchFunc, serverAddr, domainName string) mcp.ResourceHandler {
    return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
        org, slug, err := ParseResourceURI(req.Params.URI)
        if err != nil {
            return nil, fmt.Errorf("%s resource: %w", domainName, err)
        }
        text, err := fetchFn(ctx, serverAddr, org, slug)
        if err != nil {
            return nil, err
        }
        return ResourceResult(req.Params.URI, text), nil
    }
}

// NewVersionedResourceHandler creates a resource handler that also parses
// a version segment from the URI.
func NewVersionedResourceHandler(fetchFn VersionedFetchFunc, serverAddr, domainName string) mcp.ResourceHandler {
    return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
        org, slug, version, err := ParseVersionedResourceURI(req.Params.URI)
        if err != nil {
            return nil, fmt.Errorf("%s versioned resource: %w", domainName, err)
        }
        text, err := fetchFn(ctx, serverAddr, org, slug, version)
        if err != nil {
            return nil, err
        }
        return ResourceResult(req.Params.URI, text), nil
    }
}

func ResourceResult(uri, text string) *mcp.ReadResourceResult {
    return &mcp.ReadResourceResult{
        Contents: []*mcp.ResourceContents{{
            URI:      uri,
            MIMEType: "application/json",
            Text:     text,
        }},
    }
}
```

### 4. `DeleteByReference` — Two-Step Delete Pattern

Every delete function follows: resolve reference → extract ID → call delete. The only variation is the ID message type. We use a callback for that:

```go
// domains/deletehelper.go

// DeleteByReference implements the standard two-step delete pattern:
// 1. Resolve org/slug to a resource via GetByReference
// 2. Call the delete RPC with the resource's ID
//
// getByRef and deleteRPC are domain-specific functions that use the
// correct proto client types.
func DeleteByReference(
    ctx context.Context,
    serverAddress string,
    org, slug string,
    resourceDesc string,
    getByRef func(ctx context.Context, conn *grpc.ClientConn, ref *apiresource.ApiResourceReference) (proto.Message, error),
    extractID func(msg proto.Message) proto.Message,
    deleteRPC func(ctx context.Context, conn *grpc.ClientConn, id proto.Message) (proto.Message, error),
) (string, error) {
    return WithConnection(ctx, serverAddress, func(rpcCtx context.Context, conn *grpc.ClientConn) (string, error) {
        ref := &apiresource.ApiResourceReference{
            Org:  org,
            Kind: kindFromDesc(resourceDesc), // or pass kind as param
            Slug: slug,
        }
        resource, err := getByRef(rpcCtx, conn, ref)
        if err != nil {
            return "", RPCError(err, resourceDesc)
        }

        id := extractID(resource)
        deleted, err := deleteRPC(rpcCtx, conn, id)
        if err != nil {
            return "", RPCError(err, resourceDesc)
        }
        return MarshalJSON(deleted)
    })
}
```

**Note**: This helper is useful but optional. If a domain's delete has unusual logic, it can skip this and use `WithConnection` directly. The abstractions compose — you pick the level that fits.

## Before / After: Agents Domain

### Before (current): 7 files, ~278 lines

```
agents/
├── tools.go       (38 lines)
├── resources.go   (46 lines)
├── fetch.go       (39 lines)
├── apply_tool.go  (33 lines)
├── apply.go       (39 lines)
├── delete_tool.go (34 lines)
└── delete.go      (49 lines)
                   ─────────
                   278 lines
```

### After (with shared abstractions): 4 files, ~150 lines

We consolidate tool definitions into fewer files since the helpers remove the wrapper bulk:

**`agents/tools.go`** (~55 lines — all 3 tool definitions)

```go
package agents

import (
    "context"

    "github.com/modelcontextprotocol/go-sdk/mcp"
    "github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_agent ---

type GetAgentInput struct {
    Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the agent (e.g. stigmer)."`
    Slug string `json:"slug" jsonschema:"required,description=Agent slug — the unique identifier within the org (e.g. code-reviewer)."`
}

func Tool() *mcp.Tool {
    return &mcp.Tool{
        Name:        "get_agent",
        Description: "Get full details of a Stigmer agent by its org and slug (e.g. org=stigmer slug=code-reviewer).",
    }
}

func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetAgentInput) (*mcp.CallToolResult, any, error) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetAgentInput) (*mcp.CallToolResult, any, error) {
        return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)
    }
}

// --- apply_agent ---

type ApplyAgentInput struct {
    Resource string `json:"resource" jsonschema:"required,description=Full agent resource as JSON. Must include api_version\\, kind (Agent)\\, metadata (org\\, slug\\, name)\\, and spec (instructions required)."`
}

func ApplyTool() *mcp.Tool {
    return &mcp.Tool{
        Name:        "apply_agent",
        Description: "Create or update a Stigmer agent (idempotent). Provide the full agent resource as JSON.",
    }
}

func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ApplyAgentInput) (*mcp.CallToolResult, any, error) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *ApplyAgentInput) (*mcp.CallToolResult, any, error) {
        return domains.CallApply(Apply, ctx, serverAddress, input.Resource)
    }
}

// --- delete_agent ---

type DeleteAgentInput struct {
    Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the agent (e.g. stigmer)."`
    Slug string `json:"slug" jsonschema:"required,description=Agent slug — the unique identifier within the org (e.g. code-reviewer)."`
}

func DeleteTool() *mcp.Tool {
    return &mcp.Tool{
        Name:        "delete_agent",
        Description: "Delete a Stigmer agent by its org and slug. Returns the deleted agent.",
    }
}

func DeleteHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *DeleteAgentInput) (*mcp.CallToolResult, any, error) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *DeleteAgentInput) (*mcp.CallToolResult, any, error) {
        return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)
    }
}
```

**`agents/fetch.go`** (~20 lines)

```go
package agents

import (
    "context"
    "fmt"

    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
    "github.com/stigmer/stigmer/mcp-server/internal/domains"
    "google.golang.org/grpc"
)

func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
    return domains.WithConnection(ctx, serverAddress, func(rpcCtx context.Context, conn *grpc.ClientConn) (string, error) {
        client := agentv1.NewAgentQueryControllerClient(conn)
        agent, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
            Org: org, Kind: apiresourcekind.ApiResourceKind_agent, Slug: slug,
        })
        if err != nil {
            return "", domains.RPCError(err, fmt.Sprintf("agent %q in org %q", slug, org))
        }
        return domains.MarshalJSON(agent)
    })
}
```

**`agents/apply.go`** (~20 lines)

```go
package agents

import (
    "context"
    "fmt"

    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    "github.com/stigmer/stigmer/mcp-server/internal/domains"
    "google.golang.org/grpc"
)

func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
    var agent agentv1.Agent
    if err := domains.UnmarshalJSON(resourceJSON, &agent); err != nil {
        return "", fmt.Errorf("invalid agent JSON: %w", err)
    }
    return domains.WithConnection(ctx, serverAddress, func(rpcCtx context.Context, conn *grpc.ClientConn) (string, error) {
        client := agentv1.NewAgentCommandControllerClient(conn)
        result, err := client.Apply(rpcCtx, &agent)
        if err != nil {
            return "", domains.RPCError(err, fmt.Sprintf("agent %q in org %q", agent.GetMetadata().GetSlug(), agent.GetMetadata().GetOrg()))
        }
        return domains.MarshalJSON(result)
    })
}
```

**`agents/delete.go`** (~25 lines)

```go
package agents

import (
    "context"
    "fmt"

    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
    "github.com/stigmer/stigmer/mcp-server/internal/domains"
    "google.golang.org/grpc"
)

func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
    return domains.WithConnection(ctx, serverAddress, func(rpcCtx context.Context, conn *grpc.ClientConn) (string, error) {
        desc := fmt.Sprintf("agent %q in org %q", slug, org)
        queryClient := agentv1.NewAgentQueryControllerClient(conn)
        agent, err := queryClient.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
            Org: org, Kind: apiresourcekind.ApiResourceKind_agent, Slug: slug,
        })
        if err != nil {
            return "", domains.RPCError(err, desc)
        }
        cmdClient := agentv1.NewAgentCommandControllerClient(conn)
        deleted, err := cmdClient.Delete(rpcCtx, &agentv1.AgentId{Value: agent.GetMetadata().GetId()})
        if err != nil {
            return "", domains.RPCError(err, desc)
        }
        return domains.MarshalJSON(deleted)
    })
}
```

**`agents/resources.go`** (~30 lines)

```go
package agents

import (
    "github.com/modelcontextprotocol/go-sdk/mcp"
    "github.com/stigmer/stigmer/mcp-server/internal/domains"
)

func Template() *mcp.ResourceTemplate {
    return &mcp.ResourceTemplate{
        URITemplate: "stigmer://agents/{org}/{slug}",
        Name:        "stigmer_agent",
        Title:       "Stigmer Agent",
        Description: "Full definition of a Stigmer agent, identified by organization and slug.",
        MIMEType:    "application/json",
    }
}

func ResourceHandler(serverAddress string) mcp.ResourceHandler {
    return domains.NewResourceHandler(Fetch, serverAddress, "agents")
}
```

### Summary: 278 lines → ~150 lines (46% reduction)

The remaining ~150 lines are **all curated content**: tool names, descriptions, input struct definitions, proto client calls, and resource templates. Nothing mechanical is left.

## What About Adding a New Domain?

### Before (copy-paste approach)
1. Copy an existing domain directory
2. Find-replace the kind name, proto imports, client constructors
3. Customize tool/resource descriptions
4. Add registration lines to `server.go`
5. Update `kindToAuthority` map in `uriutil.go`
6. **Risk**: miss a find-replace, get wrong kind enum, forget a registration line

### After (with shared abstractions)
1. Create new domain directory
2. Write `fetch.go` (~20 lines) — the domain-specific RPC call using `WithConnection`
3. Write `tools.go` (~55 lines) — curated tool definitions and descriptions
4. Write `resources.go` (~20 lines) — template metadata + `domains.NewResourceHandler()`
5. Write `delete.go` / `apply.go` (~20-25 lines each) if needed, using `WithConnection`
6. Add registration lines to `server.go`
7. Update `kindToAuthority` map
8. **Advantage**: no copy-paste of mechanical code, only write what's specific to this domain

Steps 6 and 7 are the same either way. A future enhancement could add a `Registration()` pattern per domain to make server.go auto-discoverable, but that's optional and low priority.

## Why NOT Proto Annotations

We considered adding custom proto options (e.g., `option (stigmer.mcp.tool_name) = "get_agent"`) to drive MCP exposure from proto files. We chose not to because:

1. **Requires a protoc plugin** — non-trivial to build and maintain, adds a build dependency
2. **MCP descriptions don't belong in proto** — tool descriptions are LLM-facing product copy, not API documentation. They serve a fundamentally different audience.
3. **Proto options can't express curated input schemas** — the `jsonschema` struct tags with contextual examples (`"e.g. code-reviewer"`) are Go-specific and wouldn't map cleanly to proto annotations.
4. **The Go code already IS the source of truth** — proto stubs provide type safety at compile time. The `domains` package code directly imports and uses proto types. There's no synchronization gap like there would be with a YAML manifest.

Proto annotations would make sense if we had 50+ domains and wanted to auto-discover which RPCs to expose. At 4-10 domains, the Go registration code is simpler and more transparent.

## Revised Task Breakdown

### T01: Architecture Design (this document)
- [x] Analyze existing code patterns across all domains
- [x] Identify mechanical vs. curated code
- [x] Design shared abstraction APIs
- [x] Show before/after comparison
- [ ] Review and approve

### T02: Implement Core Helpers
**Location**: `mcp-server/internal/domains/`
**New files**:
- `grpchelper.go` — `WithConnection()` 
- `toolhelper.go` — `TextResult()`, `CallFetch()`, `CallApply()`
- `resourcehelper.go` — `NewResourceHandler()`, `NewVersionedResourceHandler()`, `ResourceResult()`

**Tests**:
- `grpchelper_test.go`
- `toolhelper_test.go`
- `resourcehelper_test.go`

**Estimated effort**: Small — ~80 lines of helpers + ~100 lines of tests

### T03: Refactor Agents Domain
- Refactor agents to use shared abstractions
- Verify all existing tests pass
- Validate no behavioral changes (same tool names, descriptions, error messages)
- This is the reference refactoring — establishes the pattern

### T04: Refactor Remaining Domains
- Refactor workflows, mcpservers, skills using the agents pattern
- Skills retains its versioned resource handling (uses `NewVersionedResourceHandler`)
- All existing tests pass

### T05: Validate and Clean Up
- Run full test suite
- Verify MCP tool surface is identical (same tool names, descriptions, input schemas)
- Remove any dead code from the refactoring
- Update `uriutil.go` if the `kindToAuthority` map can be simplified

## Comparison: Old Plan vs. New Plan

| Aspect | Old (YAML + Codegen) | New (Shared Abstractions) |
|---|---|---|
| New artifacts | Standalone repo, CLI, templates, YAML manifest | 3 helper files in existing `domains` package |
| Build dependency | `mcp-server-codegen` must run before compile | None — pure Go, compiles directly |
| Sync burden | YAML ↔ proto must stay in sync | None — Go imports proto stubs directly |
| Time to implement | Weeks (T02-T07) | Days (T02-T05) |
| Blocked by | T11-A (write operations) | Nothing — can start immediately |
| Cross-product reuse | Theoretically shared, practically complex | Stigmer-specific, Planton does its own |
| Adding a new domain | Edit YAML, run codegen, review output | Write 4-5 small Go files (~150 lines) |
| Ejection cost | Delete generator, keep generated code | Already "ejected" — it's all hand-written |
| Risk | Generator bugs produce wrong code silently | Compile errors catch mistakes immediately |

## Design Decisions

### 1. Search tool stays hand-written
Same as the original plan. Search is cross-domain and unique (~192 lines). No abstraction needed.

### 2. Versioned resources use `NewVersionedResourceHandler`
Skills uses `NewVersionedResourceHandler(Fetch, serverAddr, "skills")` which parses the version from the URI. Simple, explicit, no flags.

### 3. Tool descriptions stay in Go code
They're curated, LLM-optimized text right next to the handler. This is the right place — you see the description and implementation together.

### 4. No registration framework (for now)
Each domain still exports individual functions (`Tool()`, `Handler()`, `ApplyTool()`, etc.) and `server.go` lists them explicitly. This is transparent and easy to grep. If the domain count reaches 15+, we can add a `Registration()` pattern then.

### 5. This is Stigmer-specific
Planton uses a different SDK, different patterns, and different registration style. If Planton migrates to the official go-sdk in the future, these same abstractions could be extracted into a shared library. But we don't build that bridge until it exists.

## Success Criteria

- [ ] Shared helpers implemented with tests
- [ ] All 4 domains refactored to use helpers
- [ ] All existing tests pass without modification
- [ ] MCP tool surface is byte-for-byte identical (same names, descriptions, schemas)
- [ ] Net reduction of ~400-500 lines across the codebase
- [ ] Adding a new domain requires ~150 lines of curated code, zero copy-paste of mechanical patterns
