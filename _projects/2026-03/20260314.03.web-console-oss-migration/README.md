# Project: 20260314.03.web-console-oss-migration

## Overview

Migrate the Stigmer Web Console from stigmer-cloud to stigmer OSS. Add TypeScript proto codegen, make auth optional and provider-agnostic, build for static export, embed in the CLI's `stigmer server` command, and serve on port 8234.

**Created**: 2026-03-14
**Status**: Active 🟢

## Project Information

### Primary Goal

Ship a web console embedded in `stigmer server` that provides browser-based agent execution monitoring, session management, and resource catalog — with zero external dependencies for local use and configurable auth for cloud deployment.

### Timeline

**Target Completion**: 1-2 weeks

### Technology Stack

- **Frontend**: TypeScript, Next.js 16 (App Router), React 19, TailwindCSS v4, shadcn/ui
- **API Layer**: Connect-RPC (gRPC-Web), Protobuf (protobuf-es)
- **Backend**: Go (stigmer-server, CLI daemon)
- **Build**: Buf (proto codegen), npm workspaces, `//go:embed`

### Project Type

Migration

### Affected Components

| Component | Change Type | Description |
|-----------|------------|-------------|
| `client-apps/web/` | New | Web console application (migrated from stigmer-cloud) |
| `apis/` | Modified | Add TypeScript codegen (`buf.gen.ts.yaml`, `stubs/ts/`) |
| `client-apps/cli/` | Modified | Daemon serves web UI, `--no-web`/`--web-port` flags |
| `backend/services/stigmer-server/` | Modified | HTTP handler or separate web server for embedded SPA |

## Architectural Decisions

### Embedding Strategy: Static Export + Go Embed

The web app builds as a static SPA (`next export`) and is embedded in the Go binary via `//go:embed`. This means `stigmer server` serves the web console without requiring Node.js at runtime. Binary size increase (~5-15MB) is acceptable for the zero-dependency UX.

### Auth: Optional, Provider-Agnostic

Auth is not hardcoded to Auth0 or any provider. A runtime config flag (`authMode: disabled | oidc`) determines behavior. When disabled (OSS local default), all auth flows are bypassed. When enabled, configurable OIDC parameters drive the flow.

### Port Allocation

| Port | Service |
|------|---------|
| 7233 | Temporal gRPC |
| 7234 | stigmer-server (gRPC + Connect-RPC) |
| 8233 | Temporal UI |
| **8234** | **Stigmer Web Console** (new) |

### Single Codebase, No Fork

The web code lives only in stigmer OSS. Cloud deploys the same code with auth enabled and a different API endpoint. No separate web code in stigmer-cloud.

### Proto Codegen in OSS

TypeScript stubs generated from `apis/` proto definitions alongside Go and Python. Package `@stigmer/protos` is an internal workspace package at `apis/stubs/ts/`.

## Task Plan

| Task | Title | Status | Est. Effort |
|------|-------|--------|-------------|
| **T01** | Proto TypeScript Codegen Setup | ✅ DONE | 2-3 hrs |
| **T02** | Migrate Web Source to Stigmer Repo | ⏸️ TODO | 3-4 hrs |
| **T03** | Implement Configurable Auth | ⏸️ TODO | 3-4 hrs |
| **T04** | Configure Static Export Build | ⏸️ TODO | 2-3 hrs |
| **T05** | Embed Web UI in stigmer-server | ⏸️ TODO | 3-4 hrs |
| **T06** | CLI Integration & Polish | ⏸️ TODO | 2-3 hrs |
| **T07** | Build Pipeline & Dev Workflow | ⏸️ TODO | 2-3 hrs |

**Total estimated effort**: ~18-24 hours across 1-2 weeks

## Dependencies

- Existing proto definitions in `apis/`
- Existing stigmer-server gRPC services
- Buf CLI (already required for Go/Python codegen)
- Node.js + npm (for building web assets, not for running)

## Success Criteria

1. `stigmer server` starts and web console is accessible at `http://localhost:8234`
2. Web console connects to stigmer-server via Connect-RPC without auth in local mode
3. All pages work: Run Agent, Sessions, Catalog (agents/skills/mcp-servers), Draft
4. Auth is configurable — can be enabled with OIDC provider config for cloud deployment
5. `make protos` generates TypeScript stubs alongside Go and Python

## Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Next.js static export incompatibility with App Router dynamic routes | Use `'use client'` + client-side routing; test each page during T04 |
| Binary size increase from embedded assets | Monitor size; optimize with gzip/brotli if needed |
| Build pipeline complexity (Node.js required for building) | Document clearly in T07; CI needs both Node.js and Go |
| CORS between web (8234) and API (7234) | stigmer-server adds CORS headers for localhost origins |

## Project Structure

- **`tasks/`** — Task planning and execution logs (update freely)
- **`checkpoints/`** — Milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** — Architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** — Project-specific standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** — Corrected misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** — Anti-patterns to avoid (⚠️ ASK before creating)

## How to Resume

**Quick Resume**: Drag `next-task.md` into any chat to load full context.
