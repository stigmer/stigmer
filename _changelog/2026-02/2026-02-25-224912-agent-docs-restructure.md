# Agent Resource Documentation Restructure

**Date**: February 25, 2026

## Summary

Rewrote the Agent resource documentation from a single monolithic guide into a suite of 8 focused documents, fixed 3 critical factual errors in the proto comments and guide, and added all missing fields (visibility, org, annotations, status, Session lifecycle) that were absent from the original.

## Problem Statement

The `agent-resource-guide.md` was the single source of truth for the `agentic.stigmer.ai/v1` Agent resource, and it was actively misleading in multiple places. Since this documentation is the foundation for creating Skills (like agent-creator) and other downstream artifacts, every error propagated outward.

### Pain Points

- Proto inline YAML comments in `spec.proto` used `scope: platform` — a field that does not exist on `ApiResourceReference`. The actual field is `org`.
- The `kind` field was shown as both integers (`kind: 43`) in proto comments and lowercase strings (`kind: skill`) in the guide — with no explanation of which is correct for YAML.
- `metadata.visibility` (PUBLIC/PRIVATE) was completely undocumented despite Agents supporting marketplace publishing.
- `metadata.org` was never shown in YAML examples, leaving cloud-mode users with no guidance.
- The `Session` resource was missing from the lifecycle diagram (Agent → AgentInstance → AgentExecution), producing an incorrect mental model.
- `ToolApprovalOverride.message` inheritance behavior and silent failure for invalid tool names were undocumented.
- The monolithic format made it impossible to reference specific topics (MCP integration, sub-agents, etc.) from Skills without pulling in the entire document.

## Solution

Split the single file into 8 focused documents with clear separation of concerns, fix all proto comment errors at the source, and add every missing field and behavior identified in the audit.

## Implementation Details

### Proto Fix (`spec.proto`)

Fixed 3 inline YAML comment blocks in `AgentSpec`, `SubAgent`, and `McpServerUsage`:
- `scope: platform` → `org: local` with added `kind: mcp_server`
- `scope: platform` / `kind: 43` → `org: local` / `kind: skill`
- `scope: organization` removed, replaced with correct `org: acme-corp` / `kind: mcp_server`

### New Documentation Structure

```
apis/ai/stigmer/agentic/agent/docs/
├── README.md                  Index, lifecycle (Agent→AgentInstance→Session→AgentExecution), Docker analogy
├── agent-resource-guide.md    Core YAML schema: metadata (visibility, org, annotations), spec, status, env, CLI
├── resource-references.md     ApiResourceReference: kind is lowercase string, org:local semantics, version pinning
├── mcp-server-integration.md  MCP usage, tool approval overrides, message inheritance, silent failure, policy chain
├── skill-integration.md       Skill refs, 3-phase injection (registration→activation→bundled resources)
├── sub-agents.md              SubAgent fields, McpAccess, containment permission model
├── examples.md                6 YAML examples (minimal→full-featured + cloud-mode public agent)
└── validation-checklist.md    Pre-apply checklist + 11 common pitfalls (3 new)
```

### Key Content Additions

- `metadata.visibility`: `visibility_private` (default) / `visibility_public` for marketplace — with examples
- `metadata.org`: local mode defaults to `local`, cloud mode requires org slug — with examples
- `metadata.annotations`: acknowledged alongside labels
- `AgentStatus`: `default_instance_id` and audit trail fields documented
- `spec.description`: corrected from "Required" to "Recommended" (no `buf.validate` enforcement)
- Skill injection mechanism: explained 3-phase lazy-loading (registration, activation, bundled resources)
- Tool approval `message` inheritance: empty message falls back to McpServer default, then to auto-generated
- Silent tool name failure: typos in `tool_approval_overrides` silently disable the policy
- `AgentExecution.auto_approve_all`: explained as highest-priority runtime bypass in the policy chain

## Benefits

- Downstream Skills (agent-creator, skill-creator) can now reference specific documents instead of parsing a monolith
- Proto comments match actual field names — no more `scope` vs `org` confusion
- Cloud-mode users have explicit guidance for `org` and `visibility`
- The silent-failure pitfall for tool approval overrides is now documented, preventing security gaps
- Each document is independently reviewable and updatable

## Impact

- **Agent-creator skill** and **skill-creator skill** in the seedpack consume this documentation — accuracy directly affects generated agent YAML quality
- **New users** writing Agent YAML for the first time now have correct examples with `metadata.org`
- **Cloud-mode deployments** now have marketplace publishing guidance via `visibility`
- **Proto source** is corrected, preventing future documentation generated from proto comments from inheriting stale field names

## Related Work

- Seedpack agents (`agent-creator.yaml`, `skill-creator.yaml`) confirmed `org: local` and `kind: skill` as the correct conventions
- Agent-creator skill (`skills/agent-creator/`) references this documentation suite for validation and examples

---

**Status**: Production Ready
**Timeline**: Single session
