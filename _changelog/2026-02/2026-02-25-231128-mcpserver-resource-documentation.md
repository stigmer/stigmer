# McpServer Resource Documentation

**Date**: February 25, 2026

## Summary

Authored comprehensive documentation for the `agentic.stigmer.ai/v1` McpServer resource, mirroring the quality and depth of the existing Agent docs while covering the unique concepts McpServer introduces. The documentation is organized as seven focused, cross-linked guides covering the full resource lifecycle from authoring YAML to publishing to the marketplace.

This work also surfaced two proto inaccuracies — a non-existent `scope` field in the `api.proto` YAML example and a stale `docker` server type reference in `status.proto` — both flagged for separate cleanup.

## Problem Statement

The McpServer resource had no documentation. Its proto files define several concepts that are either entirely absent from Agent docs or exist in a different form: two transport types with distinct semantics, capability discovery (a three-source model with privacy guarantees), resource-level tool approval policies, `default_enabled_tools` gating, and `ValidationState` for structural correctness. Developers authoring McpServer YAML had no reference material.

### Pain Points

- No guidance on when to choose `stdio` vs `http` transport, or how each delivers credentials to the server
- The `${VAR_NAME}` interpolation syntax for HTTP headers and the `{{args.field}}` template syntax for approval messages were undocumented — they look similar but resolve at completely different points in the execution lifecycle
- The `default_tool_approvals` / `tool_approval_overrides` / `auto_approve_all` three-layer chain was only partially documented in Agent docs (Layer 2 only), with no documentation for Layer 1 (the McpServer-level base)
- The `stigmer discover mcp-server` workflow — including the privacy model for credential handling — was undocumented
- `DiscoveredCapabilities` and how to use its `tools[*].name` values as authoritative tool names for policies and restrictions was unknown to users
- Silent failure on typos in `tool_name` (policies are ignored without warning) was a latent footgun with no docs
- The `default_enabled_tools` field as a platform-level gate (agents can only restrict further, never expand) had no explanation

## Solution

Seven focused documents under `apis/ai/stigmer/agentic/mcpserver/docs/`, each scoped to a single concern with full cross-links:

| Document | Scope |
|---|---|
| `README.md` | Platform lifecycle, visibility/ownership model, index |
| `mcpserver-resource-guide.md` | Full YAML schema (metadata, spec, status), CLI commands |
| `server-types.md` | Stdio vs HTTP comparison, all config fields, `${VAR_NAME}` interpolation |
| `tool-approval-policies.md` | `ToolApprovalPolicy`, `{{args.field}}` templates, three-layer chain |
| `capability-discovery.md` | `DiscoveredCapabilities`, three discovery sources, CLI workflow, privacy model |
| `examples.md` | Six apply-ready YAML examples from minimal to full marketplace server |
| `validation-checklist.md` | Pre-apply checklist, nine pitfalls with before/after YAML |

## Implementation Details

### Structural Decisions

- **`server-types.md` as a standalone doc** — transport type is a foundational choice that affects credential delivery, startup cost, and operational model. Co-locating it with other spec fields would bury the decision guidance.
- **`tool-approval-policies.md` owns Layer 1** — the Agent docs own Layer 2 (`tool_approval_overrides`). This separation means each resource's docs are authoritative for their own layer, with explicit cross-references.
- **No `resource-references.md`** — McpServer is a *referenced* resource, not one that references others. The Agent's `resource-references.md` covers the reference format; duplication would create two sources of truth.

### Proto Inaccuracies Discovered and Flagged

**`api.proto` YAML example shows `scope: platform`** — `ApiResourceMetadata` has no `scope` field. The proto only defines `name`, `slug`, `id`, `org`, `visibility`, `labels`, `annotations`, `tags`, and `version`. The "platform-scoped / org-scoped / identity-account-scoped" language in `command.proto`'s auth comments describes the internal authorization model, not a user-settable field. The docs document the real schema; the proto comment needs a separate fix.

**`status.proto` comment mentions `docker`** — The `server_type` oneof in `spec.proto` only defines `stdio` and `http`. `docker` is a stale comment. Docs cover only the two real types.

### Key Content Decisions

- **`${VAR_NAME}` vs `{{args.field}}` disambiguation** — documented explicitly in `server-types.md` and `validation-checklist.md` with a comparison table. These syntaxes serve entirely different purposes and live at different points in execution; conflating them would break HTTP headers or silently produce literal placeholder text in approval messages.
- **Silent failure warning** — the tool name typo footgun (policy silently ignored, no warning) appears in three places: `tool-approval-policies.md`, `capability-discovery.md`, and `validation-checklist.md`. The frequency is intentional — this is a safety-critical behavior.
- **Privacy model in discovery** — explicitly documented: credentials for stdio servers stay on the developer's machine during CLI discovery. Only tool metadata (names, descriptions, input schemas) is transmitted to the platform. This is a trust and security guarantee worth making explicit.
- **`input_schema` as the source for `{{args.field}}` placeholder names** — the capability-discovery doc shows how to read `properties` keys from a discovered tool's schema to derive valid message template placeholders. This closes the loop between discovery and approval policy authoring.

### Example Coverage

| Example | Demonstrates |
|---|---|
| Minimal stdio | Bare minimum to apply and reference from an agent |
| Stdio with `env_spec` | Credential schema declaration and description quality |
| Stdio with `default_enabled_tools` | Platform-level tool gating — dangerous operations excluded by default |
| Stdio with `default_tool_approvals` | Approval policies with contextual `{{args.field}}` messages |
| HTTP with header authentication | `${VAR_NAME}` interpolation, timeout configuration |
| HTTP with multi-tenant routing | Multi-variable header + query param routing, mixed secret/non-secret env vars |
| Public marketplace server | `visibility_public`, detailed `env_spec` descriptions for external users, marketplace annotations |

## Benefits

- **Developers can author correct McpServer YAML on first attempt** — the schema reference, transport guide, and validation checklist cover every field with format constraints, defaults, and validation behavior.
- **Approval policy authors have a clear, auditable workflow** — discover → copy exact tool names → write policies → verify. The silent-failure footgun is documented with explicit mitigation.
- **The two-syntax confusion is eliminated** — `${VAR_NAME}` and `{{args.field}}` now have clear, distinct documentation with a side-by-side comparison table.
- **The discovery privacy model is an explicit guarantee** — not an implicit assumption.
- **Platform contributors have a single source of truth per concept** — each doc owns its layer without duplication.

## Impact

- **McpServer authors** (platform operators, org admins, marketplace publishers) — can author complete, correct definitions without reverse-engineering the proto.
- **Agent authors** — the Agent `mcp-server-integration.md` cross-links to these docs for the McpServer side of the configuration; the full picture is now reachable.
- **Platform contributors** — the proto inaccuracies (`scope` field, `docker` type) are documented as known issues for cleanup.
- **Onboarding** — new team members have complete documentation for both sides of the McpServer/Agent integration.

## Related Work

- [2026-02-25-224912-agent-docs-restructure.md](2026-02-25-224912-agent-docs-restructure.md) — Agent resource docs that these McpServer docs integrate with
- [2026-02-25-231050-skill-resource-documentation.md](2026-02-25-231050-skill-resource-documentation.md) — Skill resource docs created in the same documentation initiative
- [2026-02-25-163052-mcp-server-discovery-proto-foundation.md](2026-02-25-163052-mcp-server-discovery-proto-foundation.md) — The proto foundation for `DiscoveredCapabilities` that these docs describe

---

**Status**: ✅ Production Ready  
**Timeline**: Single session — planning, proto research, blueprint confirmation, seven documents
