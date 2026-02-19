# Next Task: 20260219.01.mcp-server-codegen

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260219.01.mcp-server-codegen

**Description**: A manifest-driven Go code generator that produces curated MCP server tool and resource handlers from a YAML config and Go templates. Targets the official modelcontextprotocol/go-sdk. Designed to be reusable across Stigmer, Planton Cloud, and future products.
**Goal**: Eliminate hand-written MCP server boilerplate by generating typed tool handlers, resource templates, fetch functions, and server wiring from a declarative YAML manifest — while preserving curated tool surfaces (not exposing every RPC).
**Tech Stack**: Go, text/template, YAML, modelcontextprotocol/go-sdk, protobuf/protojson
**Location**: Standalone repo (to be created). Project tracking here in Stigmer monorepo.
**Blocked by**: T11-A (Stigmer MCP server write operations) — must complete first to know the full read+write pattern.

## Current Status

**Created**: February 19, 2026
**Current Task**: T01 — Architecture Design
**Status**: T01 PENDING REVIEW

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — manifest schema, template structure, design decisions | PENDING REVIEW |
| T02 | Scaffold Standalone Repo — Go module, CI, Makefile | Pending |
| T03 | Core Generator — Read Tools (get_* pattern) | Pending |
| T04 | Core Generator — Write Tools (apply_*, delete_* pattern) | Pending |
| T05 | Server Wiring Generation — register_gen.go, uriutil_gen.go | Pending |
| T06 | Validate Against Stigmer — diff generated vs hand-written | Pending |
| T07 | Planton Cloud Manifest (stretch) | Pending |

## Key Design Decisions (from T01 plan)

1. **Manifest-driven, not proto-driven** — you declare which tools to expose, with curated names/descriptions
2. **Official go-sdk only** — targets `modelcontextprotocol/go-sdk`, not `mark3labs/mcp-go`
3. **Search tool stays hand-written** — it's cross-domain and unique
4. **Versioned resources via flag** — `has_versioned_resource: true` in manifest
5. **Clean generated code** — indistinguishable from hand-written, easy to eject

## Research Reference

Research report: `_projects/2026-02/20260217.01.stigmer-mcp-server/research/20260219.160000.proto-to-mcp-server-codegen/`

Key finding: Redpanda's `protoc-gen-go-mcp` exists but doesn't fit our needs (wrong SDK, not curated, no resource templates). Our manifest+template approach is the right fit.

## Essential Files

```
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_0_plan.md  — Architecture design (PENDING REVIEW)
_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md          — Stigmer MCP server project (T11-A pending)
mcp-server/                                                             — Existing hand-written code (reference patterns)
mcp-server/internal/domains/agents/                                     — Reference domain pattern
```

## Quick Commands

- "Continue with T01 review" — Review the architecture plan
- "Show manifest schema" — See the proposed YAML format
- "Compare with existing code" — Validate templates against hand-written domains

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
