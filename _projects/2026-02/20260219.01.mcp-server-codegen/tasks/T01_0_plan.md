# Task T01: Architecture Design — Manifest-Driven MCP Server Code Generator

**Created**: 2026-02-19
**Status**: PENDING REVIEW
**Type**: Feature Development
**Blocked by**: T11-A (Stigmer MCP server write operations — complete this first to validate the full read+write pattern before codifying it)

> **This plan requires your review before execution.**

## Context

We currently hand-write ~120-230 lines of Go code per MCP resource domain (tools.go, fetch.go, resources.go) following an identical pattern across Stigmer and Planton MCP servers. This project creates a **manifest-driven code generator** that eliminates that boilerplate while preserving **curated tool surfaces** — you explicitly declare which tools to expose, with what names and descriptions, rather than dumping every gRPC RPC as a tool.

### Why Not Use protoc-gen-go-mcp?

Research confirmed that Redpanda's `protoc-gen-go-mcp` exists (186 stars) and generates MCP handlers from proto services. We chose NOT to use it because:

1. **It targets `mark3labs/mcp-go`**, not the official `modelcontextprotocol/go-sdk` (issue #32 open 5 months, no progress)
2. **It exposes every RPC as a tool** — not curated. Users already filed issues (#12, #30) asking for allowlisting
3. **No resource template generation** — it only generates tools, not `stigmer://agents/{org}/{slug}` style resources
4. **We want curated, not exhaustive** — our MCP tool surface is a product API for AI, not a mirror of internal gRPC

### Design Philosophy

- **Manifest is the source of truth** for what gets exposed (not proto files)
- **Templates match our existing hand-written patterns** exactly
- **Proto stubs provide type safety** — generated code imports and uses proto-generated types
- **Official go-sdk only** — targets `modelcontextprotocol/go-sdk`

## Architecture Overview

### Input: YAML Manifest

```yaml
# mcp-server-codegen.yaml
server:
  name: mcp-server-stigmer
  go_module: github.com/stigmer/stigmer/mcp-server
  proto_stubs_module: github.com/stigmer/stigmer/apis/stubs/go
  sdk: modelcontextprotocol/go-sdk

resources:
  - kind: agent
    proto_package: ai/stigmer/agentic/agent/v1
    uri_authority: agents           # stigmer://agents/{org}/{slug}
    has_versioned_resource: false
    tools:
      - name: get_agent
        rpc: GetByReference         # from QueryController
        type: query
        description: "Get full details of a Stigmer agent by its org and slug."
        input_fields:
          - name: org
            type: string
            required: true
            description: "Organization slug that owns the agent."
          - name: slug
            type: string
            required: true
            description: "Agent slug — the unique identifier within the org."
      - name: apply_agent
        rpc: apply                  # from CommandController
        type: command
        description: "Create or update a Stigmer agent."
      - name: delete_agent
        rpc: delete                 # from CommandController
        type: command
        description: "Delete a Stigmer agent."

  - kind: skill
    proto_package: ai/stigmer/agentic/skill/v1
    uri_authority: skills
    has_versioned_resource: true     # stigmer://skills/{org}/{slug}/{version}
    tools:
      - name: get_skill
        rpc: GetByReference
        type: query
        description: "Get full details of a Stigmer skill."
        # input_fields can be omitted for standard org+slug pattern

  # ... more resources
```

**Key design choice**: `input_fields` is optional. For the common `org + slug` pattern (which covers most get tools), the generator uses a default. You only specify `input_fields` when you need something different.

### Output: Generated Go Code

For each resource in the manifest, generate:

```
internal/domains/{kind}/
├── tools.go       # Tool definitions, input structs, handlers
├── fetch.go       # gRPC client creation, RPC calls, serialization
└── resources.go   # Resource templates, URI handlers
```

Plus a central:

```
internal/server/register_gen.go   # registerTools() and registerResources()
internal/domains/uriutil_gen.go   # kindToAuthority map
```

### Generator Architecture

```
cmd/mcp-server-codegen/
├── main.go              # CLI entry point (reads manifest, runs templates)
├── manifest/
│   └── manifest.go      # YAML manifest parsing and validation
├── generator/
│   ├── generator.go     # Core generation logic
│   └── templates/       # Go text/template files
│       ├── tools.go.tmpl
│       ├── fetch.go.tmpl
│       ├── resources.go.tmpl
│       ├── register.go.tmpl
│       └── uriutil.go.tmpl
└── testdata/            # Golden file tests
```

## Task Breakdown

### T01: Architecture Design (this task)
- Define manifest schema
- Design template structure
- Validate against existing hand-written code (4 Stigmer domains)
- Decision: how to handle special cases (search tool, versioned skills)

### T02: Scaffold Standalone Repo
- Create the repo structure
- Set up Go module, CI, Makefile
- Define manifest YAML schema with validation

### T03: Core Generator — Read Tools
- Implement templates for `get_*` tools (query pattern)
- Generate tools.go, fetch.go, resources.go per domain
- Golden file tests: generated output must match existing Stigmer hand-written code

### T04: Core Generator — Write Tools
- Implement templates for `apply_*` and `delete_*` tools (command pattern)
- Depends on T11-A being complete (to know the exact write pattern)

### T05: Server Wiring Generation
- Generate register_gen.go (registerTools + registerResources)
- Generate uriutil_gen.go (kindToAuthority map)
- Full end-to-end: manifest → `go generate` → compilable MCP server

### T06: Validate Against Stigmer
- Run generator against Stigmer manifest
- Diff generated code against existing hand-written code
- Fix any discrepancies
- Integration: add `go generate` command to Stigmer MCP server Makefile

### T07: Planton Manifest (stretch)
- Create manifest for Planton MCP server
- Validate generator handles Planton's different patterns
- This assumes Planton has migrated to official go-sdk first

## Design Decisions to Confirm

### 1. How to handle the `search` tool?

The search tool is cross-domain (searches agents, skills, workflows, mcp_servers in one call). It doesn't fit the per-resource pattern. Options:

- **Option A**: Exclude search from generation; keep it hand-written (it's one file, ~80 lines)
- **Option B**: Add a `custom_tools` section in the manifest for non-standard tools

**Recommendation**: Option A. Search is unique — generating it adds complexity for no benefit.

### 2. How to handle versioned resources (skills)?

Skills have two resource templates: `stigmer://skills/{org}/{slug}` and `stigmer://skills/{org}/{slug}/{version}`. Options:

- **Option A**: `has_versioned_resource: true` flag in manifest triggers both templates
- **Option B**: Explicit list of resource templates per domain

**Recommendation**: Option A. It's the simpler model and covers the current pattern.

### 3. Where do tool descriptions live?

- **In the manifest** (proposed): Full control, curated, LLM-optimized
- **In proto comments**: Requires parsing proto source info at generation time
- **Both**: Manifest overrides, proto comments as fallback

**Recommendation**: Manifest only. Descriptions are an MCP-specific concern, not a proto concern.

### 4. Generated code style?

- **Identical to hand-written**: Generated code should be indistinguishable from the current hand-written code. No "autogenerated" boilerplate headers.
- **Reason**: If you ever need to eject from the generator, the code is already clean.

**Recommendation**: Clean generated code, but include a one-line `// Code generated by mcp-server-codegen. DO NOT EDIT.` comment (Go convention).

## Success Criteria for T01

- [ ] Manifest schema defined and documented
- [ ] Template structure designed and mapped to existing code patterns
- [ ] All 4 existing Stigmer domains can be expressed in manifest
- [ ] Special cases (search, versioned skills) have clear handling strategies
- [ ] Design reviewed and approved by developer

## Review Process

1. **You review this plan** — consider the manifest format, task breakdown, design decisions
2. **Provide feedback** — anything to change, add, or remove
3. **I revise** — create T01_2_revised_plan.md
4. **You approve** — we start with T02 (after T11-A is done)
