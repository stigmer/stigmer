# Task T01: MCP Server Setup Flow — Master Plan

**Created**: 2026-03-20
**Status**: PENDING REVIEW (revised after feedback — removed backend discovery)
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Context

Stigmer's SessionComposer has a well-designed agent setup flow: when a user selects an agent, the system proactively checks `env_spec`, collects missing credentials inline, creates a personal environment and agent instance, and resolves the agent for session creation. MCP servers have the exact same `env_spec` mechanism but no proactive flow — missing credentials are only discovered at execution time via `FAILED_PRECONDITION` errors.

Additionally, MCP servers expose tools (`status.discovered_capabilities.tools`) and approval policies (`spec.default_tool_approvals`), and `McpServerUsageInput` already supports `enabledTools` for per-tool filtering, but the UI doesn't expose any of this. Users add MCP servers as black boxes with no visibility into what tools they're enabling or which tools require HITL approval.

This project adds:
1. **Proactive secret collection** for MCP servers at selection time (mirroring agent setup)
2. **Per-tool selection** from already-discovered capabilities
3. **Approval policy visibility** — show which tools require HITL approval (read-only, from `spec.default_tool_approvals`)
4. **Shared `EnvVarForm`** extracted from `AgentEnvForm` for reuse across agent and MCP flows

**Explicitly out of scope**:
- Backend on-demand tool discovery (tools must already be discovered via seedpack, CLI, or agent-runner)
- Tool approval override configuration at session time (those are author-defined)
- New domain resources (no McpServerInstance)

### What exists today

| Aspect | Agent | MCP Server |
|--------|-------|------------|
| **Selection** | `AgentPicker` (single-select) | `McpServerPicker` (multi-select) |
| **Setup flow** | `useAgentSetup` + `AgentEnvForm` + state machine | None |
| **Secret collection** | Proactive — env_spec diff at selection | Reactive — `SecretFlowErrorGuide` on execution failure |
| **Tool selection** | N/A | Not exposed in UI (data model supports it) |
| **Approval visibility** | N/A | Not shown (data exists in `spec.default_tool_approvals`) |
| **Instance concept** | `AgentInstance` with `environment_refs` | No McpServerInstance — secrets via AgentInstance's environments |

### Architectural decisions (from recommendation phase)

1. **No new domain resources.** MCP server secrets flow through the existing personal environment. `runtimeEnv` handles the one-time path. Same two-concept model as agents (saved vs one-time).
2. **Browse-then-configure UX.** The picker stays multi-select. Servers needing configuration show an indicator. Users drill into per-server config (secrets + tools) when ready.
3. **No backend changes.** Show already-discovered tools from `status.discovered_capabilities`. If tools haven't been discovered yet, communicate that clearly and enable all tools by default.
4. **Show approval policies read-only.** Tools that have entries in `spec.default_tool_approvals` get a visual "Requires approval" badge — informational, not configurable.
5. **All in `@stigmer/react`.** Every hook and component is SDK-first.

---

## Architecture

### Data model (existing, no changes)

```
McpServer (blueprint)
  └─ spec.env_spec                  — declares required env vars (EnvironmentSpec, same as Agent)
  └─ spec.default_enabled_tools     — default tool subset (empty = all)
  └─ spec.default_tool_approvals    — ToolApprovalPolicy[] (tool_name + message template)
  └─ status.discovered_capabilities
       └─ tools[]                   — DiscoveredTool { name, description, inputSchema }
       └─ resource_templates[]      — read-only data endpoints (NOT tools)
       └─ last_discovered_at
       └─ discovered_by             — seedpack | cli | agent_runner

McpServerUsage (runtime, in Session/Agent spec)
  └─ mcp_server_ref                 — ResourceRef
  └─ enabled_tools                  — string[] (overrides default_enabled_tools)
  └─ tool_approval_overrides        — per-usage overrides (out of scope for UI)

Personal Environment (shared across agent + MCP server secrets)
  └─ data                           — map<string, EnvironmentValue>
```

### Secret delivery (no architectural change)

MCP server env vars (e.g., `GITHUB_TOKEN`) go into the same personal environment that holds agent env vars. At execution time, `envmerge.MergeEnvironmentLayers` merges all environment data, and the agent runner uses those values to start MCP server processes.

Two paths (same as agent flow):
- **Saved** (`saveForFuture: true`) → personal environment → available for all future executions
- **One-time** (`saveForFuture: false`) → `runtimeEnv` on execution creation → ephemeral

### MCP server setup flow (per-server)

```
User toggles MCP server ON in picker
       │
       ▼
Fetch full McpServer (spec + status)
       │
       ├─ Read spec.env_spec
       ├─ Read status.discovered_capabilities.tools
       └─ Read spec.default_tool_approvals
       │
   ┌───┴───┐
  NO env   HAS env_spec
  spec      │
   │        ▼
   │   diffEnvSpec(mcpServer.env_spec, personalEnv.data)
   │        │
   │    ┌───┴───┐
   │   ALL     MISSING
   │   PRESENT  vars
   │    │       │
   │    │       ▼
   │    │   Show as "needs-setup" with ⚠ indicator
   │    │   User clicks [Configure →]
   │    │       │
   │    │       ▼
   │    │   Drill into McpServerConfigPanel:
   │    │     1. EnvVarForm for missing vars
   │    │        "Save for future runs" toggle
   │    │     2. Tool selector (discovered tools)
   │    │        with approval badges
   │    │       │
   │    │       ▼
   │    │   On Apply:
   │    │     save → personalEnv.addVariables()
   │    │     one-time → hold as pendingRuntimeEnv
   │    │       │
   │    ▼       ▼
   │
   ├── Has discovered tools?
   │    │
   │  ┌─┴──┐
   │  YES  NO
   │   │    │
   │   │    ▼
   │   │   "Tools not yet discovered.
   │   │    All tools enabled by default."
   │   │    │
   │   ▼    │
   │  Show McpToolSelector:
   │  • Checkboxes per tool
   │  • Default: all enabled (or default_enabled_tools)
   │  • Approval badge on tools in default_tool_approvals
   │        │
   │        ▼
Build McpServerUsageInput {
  mcpServerRef,
  enabledTools: [...selected],
}
       │
       ▼
Server marked as "ready" in picker
```

### Multi-select orchestration

```
┌─ McpServerPicker (multi-select list) ──────────────┐
│                                                      │
│  [Search MCP servers...              ]               │
│                                                      │
│  ☑ github           ⚠ Needs setup    [Configure →]  │
│  ☑ slack            ✓ Ready           [5 tools   →]  │
│  ☐ jira                                              │
│  ☐ postgres                                          │
│                                                      │
└──────────────────────────────────────────────────────┘

States per server:
  • unchecked      — not selected
  • loading        — fetching McpServer spec + status
  • needs-setup    — selected, env_spec has missing vars (⚠ amber)
  • configuring    — user is in the drill-in config panel
  • ready          — configured, tools selected (✓ green)
  • ready-default  — no env_spec needed, using defaults (✓ green)
  • error          — fetch failed (✗ red)
```

Clicking "Configure" or the tool count transitions to the drill-in config panel within the same popover:

```
┌─ github (MCP Server) ─────────────── [← Back]  ────┐
│                                                      │
│  ┌─ Credentials required ──────────────────────┐    │
│  │  GITHUB_TOKEN    [••••••••••••]  👁          │    │
│  │  ☑ Save for future runs                      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌─ Tools (12 discovered) ────── [All] [None] ──┐   │
│  │  ☑ create_issue                                │   │
│  │    Create a new GitHub issue                    │   │
│  │  ☑ list_issues                                 │   │
│  │    List issues in a repository                  │   │
│  │  ☐ delete_branch                    🛡 Approval │   │
│  │    Delete a branch                              │   │
│  │  ☐ force_push                       🛡 Approval │   │
│  │    Force push to a branch                       │   │
│  │  ...                                           │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│                                           [Apply]    │
└──────────────────────────────────────────────────────┘
```

Tools with entries in `spec.default_tool_approvals` show a "🛡 Approval" badge. This is purely informational — it tells the user "if you enable this tool, the agent will pause for your approval before using it at runtime."

When tools haven't been discovered:

```
│  ┌─ Tools ──────────────────────────────────────┐   │
│  │  Tools have not been discovered yet.          │   │
│  │  All tools will be enabled by default.        │   │
│  │                                               │   │
│  │  Run `stigmer discover mcp-server <name>`     │   │
│  │  to populate the tool list.                   │   │
│  └──────────────────────────────────────────────┘   │
```

When the MCP server has no env_spec and tools are already discovered, the user can still click "→" to drill into the tool selector and customize which tools to enable.

### Submission blocking

The SessionComposer's "Send" button is disabled when any selected MCP server is in the `needs-setup` state. This prevents the reactive error path entirely (Nielsen's heuristic #5: Error Prevention).

A subtle warning surfaces: "Configure MCP servers to continue" with a link to open the MCP popover.

### Chip enhancements

Selected MCP servers show richer state in the composer chip bar:

| State | Chip display |
|-------|-------------|
| Ready (all tools) | `github (MCP)` |
| Ready (custom tools) | `github (MCP) 4/12` |
| Needs setup | `github (MCP) ⚠` — amber, clickable to open config |

---

## Task Breakdown

### Phase 0: Shared Foundation (Extract EnvVarForm + Move diffEnvSpec)

**Goal**: Extract the env var collection form from `AgentEnvForm` into a shared `EnvVarForm` component, and move `diffEnvSpec` to its proper home in the `environment/` module.

#### T00.1 — Extract `EnvVarForm` from `AgentEnvForm`
- **File**: `sdk/react/src/environment/EnvVarForm.tsx` (new)
- **File**: `sdk/react/src/agent/AgentEnvForm.tsx` (modify — becomes thin wrapper)
- Extract the core form logic: variable inputs (password type for secrets), visibility toggles, "Save for future runs" toggle, validation, submit
- `EnvVarForm` props:
  ```typescript
  interface EnvVarFormProps {
    variables: MissingVariable[];
    onSubmit: (values: Record<string, EnvVarInput>, options: { saveForFuture: boolean }) => void;
    onCancel?: () => void;
    isSubmitting?: boolean;
    disabled?: boolean;
    title?: string;
    submitLabel?: string;
    saveForFutureDefault?: boolean;  // default: true
  }
  ```
- `AgentEnvForm` becomes: `EnvVarForm` + agent-specific header (name, description)
- Same `--stgm-*` tokens, same A11y behavior
- **Zero breaking changes** to `AgentEnvForm` public API

#### T00.2 — Move `diffEnvSpec` to `environment/` module
- **File**: `sdk/react/src/environment/diffEnvSpec.ts` (move from `sdk/react/src/agent/diffEnvSpec.ts`)
- The function operates on `EnvironmentSpec` — the same type used by both Agent and McpServer. It's an environment concern, not agent-specific.
- Update import in `useAgentSetup.ts`
- Re-export from `environment/index.ts`

#### T00.3 — Barrel exports
- **File**: `sdk/react/src/environment/index.ts` (modify) — add `EnvVarForm`, `diffEnvSpec` exports
- **File**: `sdk/react/src/index.ts` (modify) — re-export

---

### Phase 1: MCP Server Setup Hook (Orchestration Layer)

**Goal**: Build the orchestration hook that manages multi-server setup: fetching specs, diffing env_spec, tracking per-server state, and coordinating with the personal environment.

#### T01.1 — `mcpServerSetupReducer`
- **File**: `sdk/react/src/mcp-server/mcpServerSetupReducer.ts` (new)

**State model** (per-server, managed as a map keyed by `org/slug`):

```typescript
type McpServerSetupState = Map<string, McpServerSetupEntry>;

type McpServerSetupEntry =
  | { status: "loading" }
  | { status: "needs-setup"; mcpServer: McpServer; missingVariables: MissingVariable[] }
  | { status: "configuring"; mcpServer: McpServer; missingVariables: MissingVariable[] }
  | { status: "ready"; mcpServer: McpServer; discoveredTools: DiscoveredTool[]; toolApprovals: ToolApprovalPolicy[]; enabledTools: string[]; usage: McpServerUsageInput }
  | { status: "ready-default"; mcpServer: McpServer; discoveredTools: DiscoveredTool[]; toolApprovals: ToolApprovalPolicy[]; usage: McpServerUsageInput }
  | { status: "error"; mcpServer: McpServer; error: Error };
```

Actions: `ADD_LOADING`, `RESOLVE_READY`, `RESOLVE_READY_DEFAULT`, `RESOLVE_NEEDS_SETUP`, `START_CONFIGURING`, `SUBMIT_ENV_DONE`, `SET_ENABLED_TOOLS`, `REMOVE_SERVER`, `RESET`, `ERROR`

Pure function, independently testable.

#### T01.2 — `useMcpServerSetup` orchestration hook
- **File**: `sdk/react/src/mcp-server/useMcpServerSetup.ts` (new)
- **Profile**: Both A and B
- **Composes**: `usePersonalEnvironment`, `diffEnvSpec`, existing MCP SDK client

**Hook API**:

```typescript
interface UseMcpServerSetupReturn {
  entries: Map<string, McpServerSetupEntry>;

  // Selection
  addServer: (ref: ResourceRef) => Promise<void>;
  removeServer: (ref: ResourceRef) => void;

  // Configuration (per-server)
  submitEnvVars: (ref: ResourceRef, values: Record<string, EnvVarInput>, options: { saveForFuture: boolean }) => Promise<void>;
  setEnabledTools: (ref: ResourceRef, tools: string[]) => void;

  // Derived state
  allReady: boolean;
  needsSetupCount: number;
  pendingRuntimeEnv: Record<string, EnvVarInput>;

  // Build final usages for session creation
  toUsageInputs: () => McpServerUsageInput[];

  // Reset
  reset: () => void;
}
```

**`addServer(ref)` flow**:
1. Dispatch `ADD_LOADING`
2. Fetch `McpServer` by ref via `stigmer.mcpServer.getByReference(ref)`
3. Extract from the fetched server:
   - `spec.envSpec.data` → env var requirements
   - `status.discoveredCapabilities.tools` → discovered tools (may be empty)
   - `spec.defaultToolApprovals` → approval policies
   - `spec.defaultEnabledTools` → default tool subset
4. If no env_spec or empty:
   - Build `enabledTools` from `defaultEnabledTools` (or all discovered tool names if empty)
   - Dispatch `RESOLVE_READY_DEFAULT` with `{ mcpServer, discoveredTools, toolApprovals, usage }`
5. If env_spec exists → `diffEnvSpec(mcpServer.envSpec, personalEnv.data)`
   - All present → dispatch `RESOLVE_READY` (same as above, all vars already in personal env)
   - Missing vars → dispatch `RESOLVE_NEEDS_SETUP` with `{ mcpServer, missingVariables }`

**`submitEnvVars(ref, values, { saveForFuture })` flow**:
1. If `saveForFuture: true` → `personalEnv.addVariables(values)`
2. If `saveForFuture: false` → aggregate into `pendingRuntimeEnv`
3. Build `enabledTools` from `defaultEnabledTools` or all discovered tools
4. Dispatch `SUBMIT_ENV_DONE` → transitions to `ready` with discovered tools + approvals + usage

**`setEnabledTools(ref, tools)` flow**:
1. Dispatch `SET_ENABLED_TOOLS` with the selected tool names
2. Updates the `usage.enabledTools` on that entry

**`toUsageInputs()` logic**:
- Iterate over entries, collect `usage` from each `ready` or `ready-default` entry
- If `enabledTools` contains all discovered tools → pass empty array (means "all" per the API)
- If subset → pass the list

---

### Phase 2: UI Components (Config Panel + Tool Selector)

**Goal**: Build the per-server configuration UI (secrets form + tool selector with approval badges) and integrate into the enhanced McpServerPicker.

#### T02.1 — `McpToolSelector` component
- **File**: `sdk/react/src/mcp-server/McpToolSelector.tsx` (new)
- Renders a checklist of discovered tools with approval indicators
- Props:
  ```typescript
  interface McpToolSelectorProps {
    tools: DiscoveredTool[];
    toolApprovals: ToolApprovalPolicy[];  // from spec.default_tool_approvals
    enabledTools: string[];
    onChange: (enabledTools: string[]) => void;
    disabled?: boolean;
  }
  ```
- Each tool row shows:
  - Checkbox (enabled/disabled)
  - Tool name (monospace)
  - One-line description
  - 🛡 "Approval" badge if the tool has an entry in `toolApprovals` — tooltip shows the approval message template
- Header: tool count + "Select all" / "Deselect all" shortcuts
- Scrollable when many tools (> 8 items)
- Empty state (no discovered tools): "Tools have not been discovered yet. All tools will be enabled by default. Run `stigmer discover mcp-server <name>` to populate the tool list."
- Styled with `--stgm-*` tokens, keyboard navigable (A11y)
- **Exported standalone** — platform builders can use this component independently to build custom MCP configuration UIs

#### T02.2 — `McpServerConfigPanel` component
- **File**: `sdk/react/src/mcp-server/McpServerConfigPanel.tsx` (new)
- Per-server configuration view combining secrets form + tool selector
- Props:
  ```typescript
  interface McpServerConfigPanelProps {
    mcpServer: McpServer;
    setupEntry: McpServerSetupEntry;
    onSubmitEnvVars: (values: Record<string, EnvVarInput>, options: { saveForFuture: boolean }) => void;
    onEnabledToolsChange: (tools: string[]) => void;
    onBack: () => void;
    isSubmitting?: boolean;
  }
  ```
- Layout:
  1. **Header**: MCP server name + icon (if `icon_url`) + "← Back" button
  2. **Credentials section** (only if `needs-setup` or `configuring`): `EnvVarForm` with missing variables
  3. **Tools section**: `McpToolSelector` — shown immediately if no credentials needed, shown after credential submission otherwise
  4. **Footer**: "Apply" button — disabled if credentials haven't been submitted yet
- State transitions handled visually:
  - `needs-setup` → credentials form visible, tools section collapsed/disabled
  - After credentials submitted → tools section becomes active
  - `ready` → both sections show current state, "Apply" is active
- Error state from credential submission shown inline
- Uses `--stgm-*` tokens exclusively, fully embeddable

#### T02.3 — Enhance `McpServerPicker` with setup integration
- **File**: `sdk/react/src/mcp-server/McpServerPicker.tsx` (modify)
- Add setup state indicators per server in the list:
  - `loading` → spinner on the row
  - `needs-setup` → ⚠ amber badge + "Configure" action
  - `ready` / `ready-default` → ✓ green badge + tool count (clickable to drill into config for tool customization)
  - `error` → ✗ red badge with error message
- **Drill-in support**: clicking "Configure" or the tool count transitions the popover content from the picker list to `McpServerConfigPanel` for that server
- "← Back" from config panel returns to the picker list
- New props (additive, backward-compatible):
  ```typescript
  // Added to existing McpServerPickerProps
  setupEntries?: Map<string, McpServerSetupEntry>;
  onServerAdded?: (ref: ResourceRef) => void;
  onServerRemoved?: (ref: ResourceRef) => void;
  onSubmitEnvVars?: (ref: ResourceRef, values: Record<string, EnvVarInput>, options: { saveForFuture: boolean }) => void;
  onEnabledToolsChange?: (ref: ResourceRef, tools: string[]) => void;
  ```
- **Backward compatible**: if `setupEntries` is not provided, picker behaves exactly as today (simple toggle, no setup flow)

---

### Phase 3: SessionComposer Integration

**Goal**: Wire `useMcpServerSetup` into the SessionComposer, add submission blocking, and enhance chips.

#### T03.1 — Wire `useMcpServerSetup` into SessionComposer
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- Instantiate `useMcpServerSetup(org)` alongside existing `useAgentSetup(org)`
- When user toggles a server ON in picker: call `mcpServerSetup.addServer(ref)`
- When user toggles a server OFF: call `mcpServerSetup.removeServer(ref)`
- Pass `setupEntries` and all callbacks to the enhanced `McpServerPicker`
- Build final usages from `mcpServerSetup.toUsageInputs()` for session creation
- Make MCP popover controlled (like agent popover) — stays open during configuration

#### T03.2 — Submission blocking
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- Disable send button when `mcpServerSetup.needsSetupCount > 0`
- Show inline warning: "Configure MCP servers to continue" with a button to open MCP popover
- Warning uses `--stgm-*` amber token for visibility
- Blocked state clears immediately when all servers are configured or unconfigured servers are removed

#### T03.3 — Enhanced MCP chips
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- MCP chips show richer state:
  - Ready (all tools): `github (MCP)`
  - Ready (custom tools): `github (MCP) 4/12`
  - Needs setup: `github (MCP) ⚠` — amber color, clickable to open MCP popover
- Clicking an amber chip opens the MCP popover (future: directly to that server's config)

#### T03.4 — Runtime env aggregation
- **File**: `sdk/react/src/composer/SessionComposer.tsx` (modify)
- When creating an execution, aggregate one-time env vars from:
  1. Agent setup one-time path (`agentSetup` when `mode: "oneTime"`)
  2. MCP setup one-time vars (`mcpServerSetup.pendingRuntimeEnv`)
  3. User-provided one-time secrets from `OneTimeSecretsInput`
- Merge all into a single `runtimeEnv` for execution creation
- Key conflict: if the same key appears from multiple sources, last-write-wins (MCP and agent env_specs often share keys like `GITHUB_TOKEN` — the value is the same)

#### T03.5 — Barrel exports
- **File**: `sdk/react/src/mcp-server/index.ts` (modify) — add new exports
- **File**: `sdk/react/src/index.ts` (modify) — re-export

---

## Execution Order

| Phase | Dependency | Why this order |
|-------|-----------|----------------|
| Phase 0 (EnvVarForm + diffEnvSpec) | None | Foundation — needed by Phase 1 and Phase 2 |
| Phase 1 (useMcpServerSetup) | Phase 0 | Core orchestration logic, uses EnvVarForm types and diffEnvSpec |
| Phase 2 (UI components) | Phase 0 (EnvVarForm), Phase 1 (setup state types) | UI layer consumes the setup hook's state model |
| Phase 3 (SessionComposer) | Phase 1, Phase 2 | Final wiring |

Recommended: **Phase 0 → Phase 1 → Phase 2 → Phase 3**

Sequential because each phase builds on the previous. Phase 0 is small (extraction), Phase 1 is the core logic, Phase 2 is the visual layer, Phase 3 is integration.

---

## SDK Placement Summary

### New hooks (2) — all in `@stigmer/react`

| Hook | Module | Layer | Purpose |
|------|--------|-------|---------|
| `useMcpServerSetup` | `mcp-server/` | 2 (orchestration) | Multi-server setup: env check + tool selection |
| `mcpServerSetupReducer` | `mcp-server/` | internal | Pure reducer for setup state machine |

### Moved utilities (1)

| Utility | From | To | Reason |
|---------|------|----|--------|
| `diffEnvSpec` | `agent/diffEnvSpec.ts` | `environment/diffEnvSpec.ts` | Operates on `EnvironmentSpec`, shared by agent + MCP |

### New components (3) — all in `@stigmer/react`

| Component | Module | Purpose |
|-----------|--------|---------|
| `EnvVarForm` | `environment/` | Shared env var collection form (extracted from AgentEnvForm) |
| `McpToolSelector` | `mcp-server/` | Tool checklist with approval badges |
| `McpServerConfigPanel` | `mcp-server/` | Per-server config: secrets + tools |

### Modified files (7)

| File | Change |
|------|--------|
| `sdk/react/src/agent/AgentEnvForm.tsx` | Thin wrapper over `EnvVarForm` |
| `sdk/react/src/agent/useAgentSetup.ts` | Import `diffEnvSpec` from `environment/` |
| `sdk/react/src/mcp-server/McpServerPicker.tsx` | Setup state indicators, drill-in support |
| `sdk/react/src/composer/SessionComposer.tsx` | Wire setup hook, submission blocking, enhanced chips, runtimeEnv aggregation |
| `sdk/react/src/mcp-server/index.ts` | New exports |
| `sdk/react/src/environment/index.ts` | New exports (EnvVarForm, diffEnvSpec) |
| `sdk/react/src/index.ts` | Re-exports |

### No backend changes

All data needed (env_spec, discovered tools, approval policies) already exists on the McpServer resource. The frontend reads what's available and presents it.

---

## Design Decisions

- **DD-001**: MCP secrets through personal environment (no McpServerInstance) — simplest architecture, no new domain concepts
- **DD-002**: Browse-then-configure over sequential wizard — respects multi-select, reduces popover fatigue
- **DD-003**: Show already-discovered tools only (no live discovery) — avoids backend changes, uses existing seedpack/CLI/agent-runner discovery
- **DD-004**: Approval policies shown read-only — 🛡 badge per tool, informational for user awareness, not configurable
- **DD-005**: Shared `EnvVarForm` extraction — DRY, consistent UX across agent and MCP flows
- **DD-006**: Submission blocking for unconfigured servers — prevents reactive error path (Error Prevention)
- **DD-007**: `diffEnvSpec` moved to `environment/` module — operates on `EnvironmentSpec`, shared concern
- **DD-008**: Tool approval override UI out of scope — author-defined policy, not user-configurable at session time

---

## Open Questions

1. **Popover size**: The config panel (secrets + tool selector) is larger than the current picker. Should it expand the popover, or should we use a slide-over / drawer instead? Recommendation: expand the popover with a max-height and scroll, matching the pattern used for `AgentEnvForm` in the agent flow.

2. **Tool count in chips**: When tools are customized (e.g., 4/12), should the chip show the fraction? Or just "4 tools"? Recommendation: fraction (`4/12`) — more informative, communicates that customization happened relative to the total.

3. **Per-server vs batched credential collection**: If two MCP servers both need `GITHUB_TOKEN`, should the user type it once or twice? Recommendation: once — `diffEnvSpec` checks the personal environment, and once `GITHUB_TOKEN` is saved for the first server, the second server's diff will find it already present. The user only fills vars that are truly missing.

---

## Notes

- Every new hook must include JSDoc documenting purpose, flow, layer, and usage example
- Every new component must use `--stgm-*` tokens exclusively
- All components must be keyboard navigable and screen-reader compatible
- The `McpServerConfigPanel` must work identically in the Console and when embedded in a third-party app
- The "Save for future runs" toggle default is ON (same as agent flow)
- When tools are not discovered, the user gets a clear message and a CLI hint, but is not blocked

---

## Review Process

**What happens next**:
1. **You review this plan** — challenge any task, question any decision, reorder as you see fit
2. **Provide feedback** — I'll capture it in `T01_1_review.md`
3. **I'll revise the plan** — create `T01_2_revised_plan.md` incorporating your feedback
4. **You approve** — explicit go-ahead to begin execution
5. **Execution begins** — tracked in `T01_3_execution.md`
