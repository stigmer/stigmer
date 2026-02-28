# Environment Resource Documentation

**Date**: February 28, 2026

## Summary

Added a comprehensive documentation suite for the `agentic.stigmer.ai/v1` Environment resource, covering both the API-level reference (`apis/`) and the product-level narrative (`docs/product/`). The Environment resource now has the same depth of documentation as Agent, AgentInstance, AgentExecution, Skill, and MCPServer — completing the full coverage of Stigmer's core resource set.

## Problem Statement

The Environment resource had no documentation beyond inline proto comments. Developers and users had no reference for how to create and configure environments, which field combinations to use, how secret vs. non-secret values behave, or why the resource exists as a separate concept from AgentInstance.

### Pain Points

- No `docs/` folder under `apis/ai/stigmer/agentic/environment/` — the only other agentic resource without one
- No product-level "what is" narrative explaining the problem Environment solves or how it fits the four-layer resource stack
- The secret vs. non-secret distinction, encrypted-at-rest behavior, and API redaction rules were only described in proto comments scattered across `spec.proto`
- No examples showing common patterns: plain config only, secrets only, mixed, multi-service bundles, staging vs. production rotation

## Solution

Created a three-file API documentation suite under `apis/ai/stigmer/agentic/environment/docs/` and a product narrative at `docs/product/what-is-environment.md`, mirroring the structure established for AgentInstance docs and the existing "what is" series.

## Implementation Details

### `apis/ai/stigmer/agentic/environment/docs/README.md`

Index document covering:
- What Environment is and where it sits in the resource chain (`Environment → AgentInstance → AgentExecution`)
- Key capabilities: per-value secret marking, encryption at rest, reusability, layered merging, per-value descriptions
- Documentation index table linking to the two companion docs
- Proto source table mapping each `.proto` file to its contents

### `apis/ai/stigmer/agentic/environment/docs/environment-resource-guide.md`

Complete schema reference covering:
- Resource structure (`metadata`, `spec`, `status`)
- All top-level fields with required/optional classification
- Metadata fields including visibility notes (PRIVATE by default)
- `EnvironmentSpec` fields (`description`, `data`)
- `EnvironmentValue` fields (`value`, `is_secret`, `description`) with a secret vs. non-secret comparison table showing storage behavior, log visibility, API read behavior, and recommended use cases
- Status fields (`spec_audit`, `status_audit`) with the reminder that status is system-managed
- Authorization model: FGA permission table with the callout that secret values are never returned in get/list responses
- CLI commands for apply, create, update, delete, get, and list

### `apis/ai/stigmer/agentic/environment/docs/examples.md`

Seven progressive examples:
1. Minimal — description only (placeholder before values are populated)
2. Non-secret configuration only — region names, log levels, feature flags
3. Secrets only — GitHub token, webhook secret
4. Mixed — AWS region + access key ID + secret key in a single environment
5. Multi-service bundle — GitHub, Jira, Datadog, and Slack credentials together
6. Staging vs. production — same keys, different values, swap-by-reference pattern
7. Full-featured — labels, annotations, tags, and mixed values

Plus a secret rotation example (update the environment, no AgentInstance changes needed) and inspection commands.

### `docs/product/what-is-environment.md`

Product narrative following the established "what is" format:
- **One-sentence positioning**: anchored to the `.env` file mental model, but versioned and access-controlled
- **Executive summary**: where Environment sits in the four-layer stack, secret vs. non-secret distinction
- **Problem statement**: six failure modes of embedding credentials in Agent definitions or scattering them in application code; each maps to an Environment capability that resolves it
- **The Environment resource**: annotated YAML spec example, `EnvironmentValue` field table, secret vs. non-secret decision table (what goes in each), and status YAML sample
- **How Environments are used**: AgentInstance referencing, layered merging, execution-time resolution
- **Reusability**: one Environment, many agents pattern with a visual tree
- **Secret rotation without downtime**: `apply` once, all agents pick it up
- **Access control**: FGA permission table with the callout that secret values are never exposed via any API or CLI call
- **Getting started**: CLI commands matching the style of other "what is" docs
- **How it compares**: without/with table across seven dimensions
- **Further reading**: links to Environment resource guide, examples, AgentInstance, Agent, AgentExecution

## Benefits

- Environment is now fully documented alongside all other core Stigmer resources — no gaps in the API reference
- The secret vs. non-secret decision table eliminates a common source of confusion: developers now have a clear guide for which fields to mark secret
- The "what is" doc explains the *why* — the problem of credentials in agent definitions — not just the *what*, making it useful as an onboarding document
- The rotation example makes credential lifecycle management self-documenting without requiring a support escalation

## Impact

- **Developers** building agents: clear reference for creating Environment resources and understanding what gets encrypted vs. stored as plaintext
- **Platform teams**: the reusability and layered merging sections explain how to design shared base environments for multi-team deployments
- **New users onboarding**: the "what is" doc positions Environment in the four-layer stack and explains why it exists as a separate resource from AgentInstance
- **Marketplace agent authors**: the "without/with" comparison explains how credential-free Agent templates work and why consumers should create their own Environments

## Related Work

- [AgentInstance Resource Documentation](2026-02-28-233148-mcp-credential-resolution-post-apply-discovery.md) — the companion resource that references Environments via `environment_refs`
- [Agent Docs Restructure](2026-02-25-224912-agent-docs-restructure.md) — established the `apis/.../docs/` pattern this follows
- [MCPServer Resource Documentation](2026-02-25-231128-mcpserver-resource-documentation.md) — same documentation structure applied to MCP servers
- [Skill Resource Documentation](2026-02-25-231050-skill-resource-documentation.md) — same documentation structure applied to skills

---

**Status**: ✅ Production Ready  
**Files added**: 4 (`README.md`, `environment-resource-guide.md`, `examples.md`, `what-is-environment.md`)
