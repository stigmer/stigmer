---
name: McpServer Docs
overview: Create a comprehensive `docs/` folder for the McpServer resource under `apis/ai/stigmer/agentic/mcpserver/`, mirroring the quality and structure of the existing `agent/docs/` but tailored to the unique concepts McpServer introduces (scopes, server types, capability discovery, tool approval policies at the resource level).
todos:
  - id: blueprint-confirm
    content: "Confirm two open questions with user: (1) is `scope` a user-settable field in McpServer metadata?, (2) acknowledge the `docker` type inconsistency in status.proto comment vs spec.proto oneof"
    status: completed
  - id: readme
    content: Create README.md — overview of McpServer, where it fits in platform lifecycle (Agent → McpServer → AgentInstance → AgentExecution), table of contents
    status: completed
  - id: resource-guide
    content: "Create mcpserver-resource-guide.md — full YAML schema reference: metadata (including scope), spec fields table, status fields, CLI commands (apply/get/list/delete/discover)"
    status: completed
  - id: server-types
    content: "Create server-types.md — stdio vs HTTP: when to use each, all configuration fields, env var interpolation syntax (${VAR_NAME}), working_dir, headers, timeout"
    status: completed
  - id: tool-approvals
    content: Create tool-approval-policies.md — default_tool_approvals at McpServer level, ToolApprovalPolicy fields, {{args.field}} template syntax, fallback chain (McpServer → Agent override → auto_approve_all)
    status: completed
  - id: capability-discovery
    content: Create capability-discovery.md — DiscoveredCapabilities structure, three discovery sources (seedpack/cli/agent-runner), CLI discovery workflow, privacy model, how agents use discovered tool names
    status: completed
  - id: examples
    content: Create examples.md — minimal stdio, stdio with approval policies, HTTP server with headers, full public marketplace McpServer, env spec examples
    status: completed
  - id: validation-checklist
    content: Create validation-checklist.md — pre-apply checklist, common pitfalls (oneof required, scope/org combination, tool name case sensitivity, ${VAR} vs {{args.}} syntax confusion)
    status: completed
isProject: false
---

# McpServer Resource Documentation Plan

## Doc Blueprint (per `_roles/002_document_writer`)

### Audience Audit

- **Primary:** Platform developers referencing McpServer in Agent YAML — their job is to pick the right MCP server, configure it correctly, and understand what tools it exposes.
- **Secondary:** Platform operators / org admins defining and publishing McpServer resources to the marketplace — their job is to author a correct, discoverable, well-governed McpServer definition.
- **Tertiary:** Contributors and reviewers maintaining the platform — their job is to understand what the contracts are.

### Gap Analysis

The McpServer proto (`spec.proto`, `api.proto`, `status.proto`, `command.proto`, `query.proto`, `io.proto`) contains significant domain-specific concepts that have **no documentation today**:

- The **three-level scope model** (`platform` / `organization` / `identity-account`) — absent from agent docs entirely, yet present in McpServer's auth model and the api.proto YAML example. Needs explicit explanation.
- **Two server transport types** (`stdio` vs `http`) — oneof with `required` validation, each with distinct configuration fields, use cases, and env var interpolation rules.
- **Capability discovery** — a three-source model (seedpack, CLI, agent-runner future) with a specific CLI workflow and privacy guarantees.
- `**default_tool_approvals`** at the McpServer level — the base layer of the approval policy chain; agents inherit these. The message template syntax (`{{args.field}}`) needs proper documentation here since it originates at this level.
- `**default_enabled_tools`** — the McpServer-level default that agent `enabled_tools` overrides.
- `**ValidationState**` and the validation lifecycle — McpServer has structured validation state that Agent does not.
- **Reference format and marketplace semantics** — `"org/slug"` canonical form, `visibility_public` for marketplace publishing, scope-aware access control.

### Proposed Document Set

7 files under `apis/ai/stigmer/agentic/mcpserver/docs/`:


| File                          | Mirrors Agent Doc                     | Purpose                                                                                         |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md`                   | `README.md`                           | What is McpServer, where it fits in the platform lifecycle, table of contents                   |
| `mcpserver-resource-guide.md` | `agent-resource-guide.md`             | Full YAML schema (metadata + scope, spec fields, status, CLI commands)                          |
| `server-types.md`             | *(new — McpServer-specific)*          | Stdio vs HTTP: when to use each, all fields, env var interpolation (`${VAR}`)                   |
| `tool-approval-policies.md`   | *(extends mcp-server-integration.md)* | `default_tool_approvals`, `ToolApprovalPolicy`, `{{args.field}}` templates, full policy chain   |
| `capability-discovery.md`     | *(new — McpServer-specific)*          | `DiscoveredCapabilities`, three discovery sources, CLI flow, privacy model                      |
| `examples.md`                 | `examples.md`                         | YAML examples from minimal stdio → full HTTP with approval policies → marketplace public server |
| `validation-checklist.md`     | `validation-checklist.md`             | Pre-apply checklist, common pitfalls (scope mistakes, tool name typos, oneof errors)            |


Note: No `resource-references.md` is needed — McpServer is a *referenced* resource, not one that references others. The agent's `resource-references.md` already covers how to reference an McpServer from an Agent.

---

## Key Design Decisions to Confirm With You

Before executing, I want to surface **two open questions** that could significantly affect the documentation:

**1. Scope field:** The `api.proto` YAML example shows `scope: platform`, and `command.proto` references three scopes (platform, organization, identity-account). But the `agent-resource-guide.md` has no `scope` field — only `org`. I want to confirm: Is `scope` a real, user-settable field in McpServer metadata? Or is it inferred/computed? This will determine whether the resource guide includes a dedicated scope section.

**2. `docker` server type:** The McpServer status proto comment says `stdio, http, or docker` as valid server types, but `spec.proto` only defines `stdio` and `http` oneof variants — no `docker` type exists in the proto. This is either a stale comment or a planned-but-not-yet-implemented type. I'll flag this in the docs as a proto comment inconsistency rather than documenting a nonexistent type.

---

## Source Files (Read-only, no modifications)

All content derives from:

- `[apis/ai/stigmer/agentic/mcpserver/v1/spec.proto](apis/ai/stigmer/agentic/mcpserver/v1/spec.proto)`
- `[apis/ai/stigmer/agentic/mcpserver/v1/api.proto](apis/ai/stigmer/agentic/mcpserver/v1/api.proto)`
- `[apis/ai/stigmer/agentic/mcpserver/v1/status.proto](apis/ai/stigmer/agentic/mcpserver/v1/status.proto)`
- `[apis/ai/stigmer/agentic/mcpserver/v1/command.proto](apis/ai/stigmer/agentic/mcpserver/v1/command.proto)`
- `[apis/ai/stigmer/agentic/mcpserver/v1/query.proto](apis/ai/stigmer/agentic/mcpserver/v1/query.proto)`
- `[apis/ai/stigmer/agentic/mcpserver/v1/io.proto](apis/ai/stigmer/agentic/mcpserver/v1/io.proto)`
- `[apis/ai/stigmer/agentic/agent/docs/](apis/ai/stigmer/agentic/agent/docs/)` (structural reference)

## Output Location

All 7 files created under `apis/ai/stigmer/agentic/mcpserver/docs/`