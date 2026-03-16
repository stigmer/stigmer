# Go SDK: Pulumi-to-Stripe Restructure

**Date**: March 16, 2026

## Summary

Replaced the entire Go SDK from a Pulumi-style synthesis model (`stigmer.Run()` → manifest files → CLI deploy) to a Stripe-style API client (`client.Agent.Create(ctx, input)` → direct gRPC call). Extended the codegen pipeline to generate resource clients, input types, and shared types from proto service definitions. Reduced ~51,000 lines of handwritten code to ~500 lines of handwritten + ~1,200 lines of generated code.

## Problem Statement

The Go SDK was designed around a declarative synthesis model inspired by Pulumi: define resources in Go code, call `stigmer.Run()` to serialize protobuf manifests to disk, then have the CLI deploy them. This model was architecturally misaligned with how developers actually want to use the platform.

### Pain Points

- Developers expected a direct API client (like Stripe, Twilio, or Google Cloud SDKs), not a manifest-generation pipeline
- The synthesis model required understanding `stigmer.Context`, output directories, and manifest semantics before making a single API call
- 8 domain-specific sub-packages (`agent/`, `skill/`, `mcpserver/`, `environment/`, `workflow/`, `ref/`, `metadata/`, `context/`) each with their own validation, error handling, and proto conversion — massive surface area for 5 core resources
- Codegen only produced `Args` structs and workflow task configs, requiring all client logic to be handwritten
- The SDK included resources beyond the initial 5 (workflows, environments, IAM policies, organizations, projects) adding maintenance burden without immediate value

## Solution

Complete replacement with a Stripe-style API client SDK built on an extended codegen pipeline:

1. **Two-stage codegen**: `proto2schema` extracts service schemas (RPCs, message types, spec fields) from proto files into JSON, then `sdk_client.go` generates typed Go client code
2. **Clean `internal/gen/` package**: All generated code lives in `sdk/go/internal/gen/`, wiped and recreated on each `make codegen` run
3. **Thin handwritten surface**: 5 files in the root `stigmer` package (`client.go`, `errors.go`, `options.go`, `search.go`, `types.go`) provide the public API via type aliases over `internal/gen/`
4. **gRPC transport**: Standard Go gRPC with API key auth interceptor and TLS, matching the server's exposed protocol

## Implementation Details

### Codegen Pipeline

```
Proto files (apis/)
    ↓
proto2schema (Stage 1) → JSON schemas + service schemas
    ↓
sdk_client.go (Stage 2) → sdk/go/internal/gen/
    ├── agent.go         (AgentClient, AgentInput, nested types)
    ├── skill.go         (SkillClient, SkillInput)
    ├── mcpserver.go     (McpServerClient, McpServerInput, nested types)
    ├── session.go       (SessionClient — no spec schema, uses proto types)
    ├── execution.go     (AgentExecutionClient, AgentExecutionInput, nested types)
    ├── errors.go        (Error, ErrorCode, sentinel checks)
    └── types.go         (shared types: DeleteResourceInput, ResourceRef, Page, etc.)
```

### Generated Input Types

Each resource gets a Go input struct with a `toProto()` method:

```go
type AgentInput struct {
    Name         string
    Org          string
    Tags         []string
    Visibility   apiresource.ApiResourceVisibility
    Instructions string
    McpServerUsages []*McpServerUsageInput
    SubAgents    []*SubAgentInput
    // ...
}
```

### Public API Surface

```go
client, _ := stigmer.NewClient("sk_live_abc123")
agent, _ := client.Agent.Create(ctx, &stigmer.AgentInput{...})
exec, _ := client.AgentExecution.Create(ctx, &stigmer.AgentExecutionInput{...})
stream, _ := client.AgentExecution.Subscribe(ctx, execID)
results, _ := client.Search.Query(ctx, "code reviewer", &stigmer.Page{...})
```

### Naming Conventions

- Domain-aligned: `client.AgentExecution` (not `client.Execution`)
- Singular: `client.Agent` (not `client.Agents`)
- Operation-agnostic inputs: `AgentInput` (not `CreateAgentInput`) — same struct for Create, Update, Apply

## Benefits

- **51,000 → 1,700 lines**: Dramatic reduction in SDK surface area and maintenance burden
- **Zero ceremony**: `NewClient(apiKey)` → start calling APIs immediately
- **Codegen-driven**: Adding a new resource means adding a config entry, not writing a client from scratch
- **Clean regeneration**: `make codegen` wipes and recreates all generated code — no merge conflicts, no stale artifacts
- **Automated chain**: `make protos` in root now runs proto stub generation AND SDK codegen in sequence
- **Standard patterns**: Follows Go SDK conventions (flat root package, `internal/` for implementation, type aliases for public API)

## Impact

- **SDK consumers**: Can now interact with Stigmer as a direct API client — familiar pattern for anyone who has used Stripe, Twilio, or Google Cloud Go SDKs
- **Platform team**: Codegen reduces per-resource maintenance to schema configuration; adding Session or extending AgentExecution requires only JSON schema updates
- **Codegen pipeline**: Now supports both Args structs (legacy) and full client generation, with a clear extension point for TypeScript SDK generation

## Related Work

- Phase 1, Track A (TypeScript SDK) — next work item, will evaluate extending the same codegen pipeline
- Phase 2 (`@stigmer/react` consolidation) — depends on `@stigmer/sdk` from Track A
- Design decision document: `_projects/2026-03/20260316.01.sdk-package-restructure/design-decisions/go-sdk-api-surface.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~3 hours)
