# Task T04: React SDK + UI Redesign + Cleanup

**Created**: 2026-04-08
**Status**: PENDING (blocked on T01)
**Scope**: stigmer OSS — `sdk/react/src/mcp-server/`
**Estimated effort**: Substantial — new hook, major component rewrite, deletion of deprecated code

## Objective

Replace the two-button (Discover + Generate Policies) UX with a single "Connect" flow. Create the `useMcpServerConnect` hook, redesign `McpServerDetailView` with a Connect bar above tabs, and delete all deep-agent policy generation code.

## Detailed Changes

### 1. New: useMcpServerConnect Hook

**File**: `sdk/react/src/mcp-server/useMcpServerConnect.ts`

```typescript
export interface UseMcpServerConnectReturn {
  /** Trigger the connect flow: discover tools + classify approvals. */
  readonly connect: (
    mcpServerId: string,
    runtimeEnv?: Record<string, EnvVarInput>,
  ) => Promise<McpServer>;
  /** true while connect is in flight. */
  readonly isConnecting: boolean;
  /** Error from most recent connect, or null. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}
```

Implementation:
- Uses `useStigmer()` to get the SDK client
- Calls `stigmer.mcpServer.connect(input)` (the renamed RPC)
- Maps `runtimeEnv` to the proto `ConnectInput.runtime_env` format
- Same error handling pattern as `useDiscoverCapabilities`

### 2. Redesign: McpServerDetailView

**File**: `sdk/react/src/mcp-server/McpServerDetailView.tsx`

#### Props changes:
- **REMOVE** `onPolicySessionCreated` prop (no more agent session for policies)
- **KEEP** all other props unchanged

#### State changes:
- **REMOVE** `policyPanelExecutionId` state
- **REPLACE** `useDiscoverCapabilities()` with `useMcpServerConnect()`
- **REMOVE** `useTriggerApprovalPolicySession()`
- **REMOVE** `handleGenerateApprovalPolicies` callback
- **RENAME** `handleDiscoverClick` → `handleConnectClick` (same credential-check logic)

#### Layout change — Connect bar above tabs:

```
┌─────────────────────────────────────────────────┐
│ Capabilities                                      │
│ ┌─────────────────────────────────────────────┐  │
│ │ [Connect bar]                                │  │
│ │ "11 tools, 3 policies" | [Reconnect]        │  │
│ │ — or —                                       │  │
│ │ "Not connected yet"    | [Connect]           │  │
│ └─────────────────────────────────────────────┘  │
│ [Credential form — inline, when needed]          │
│ ┌──────┬──────────┬───────────┐                  │
│ │Tools │ Policies │ Resources │                  │
│ ├──────┴──────────┴───────────┤                  │
│ │ (read-only tab content)     │                  │
│ └─────────────────────────────┘                  │
└─────────────────────────────────────────────────┘
```

New `ConnectBar` internal component (above the `Tabs`):
- Shows connection status + tool/policy counts
- Single button: "Connect" (first time) or "Reconnect" (has discovered tools)
- Spinner state while connecting
- Error banner for connection failures
- Credential form slides in below when env_spec has missing variables

#### ToolsTabContent simplification:
- **REMOVE** the action bar (Discover/Re-discover button row)
- **REMOVE** `showCredentialForm` handling (moved to ConnectBar)
- Keep only the tool list display — pure read-only

#### PoliciesTabContent simplification:
- **REMOVE** Generate/Regenerate button and action bar
- **REMOVE** `ApprovalPolicyGeneratorPanel` integration
- Show two visual groups:
  - **Pinned** (from `spec.pinned_tool_approvals`) — shown with a pin/lock icon, visually distinct
  - **Auto-classified** (from `status.tool_approvals`) — shown as default entries
- Pure read-only display

### 3. Delete: Deep Agent Policy Generation Code

**Files to delete entirely**:
- `sdk/react/src/mcp-server/useTriggerApprovalPolicySession.ts`
- `sdk/react/src/mcp-server/ApprovalPolicyGeneratorPanel.tsx`

**Files to clean up**:
- `sdk/react/src/mcp-server/useDiscoverCapabilities.ts` — DELETE (replaced by `useMcpServerConnect`)
- `sdk/react/src/mcp-server/index.ts` — update exports: remove deleted hooks/components, add `useMcpServerConnect`

### 4. Update: Package Exports

**File**: `sdk/react/src/mcp-server/index.ts`

- Remove exports: `useDiscoverCapabilities`, `useTriggerApprovalPolicySession`, `ApprovalPolicyGeneratorPanel`
- Add export: `useMcpServerConnect`, `UseMcpServerConnectReturn`
- Remove `onPolicySessionCreated` from `McpServerDetailViewProps` type export

### 5. Update: Site Demo Scenarios (if applicable)

Check if any doc demos reference the deleted hooks:
- `site/src/components/docs/demos/scenarios/mcp-server-detail/discover-capabilities-playback/`
- `site/src/components/docs/demos/scenarios/mcp-server-detail/generate-policies-playback/`
- `site/src/components/docs/demos/scenarios/mcp-server-detail/connect-tools-tour/`

Update or remove as needed.

## UX State Machine

```
NotConnected → [Click Connect] → CredentialForm (if env_spec needed) → Connecting → Connected
NotConnected → [Click Connect] → Connecting (no credentials needed) → Connected
Connected → [Click Reconnect] → Connecting → Connected
Connecting → Error → NotConnected (with error banner)
```

Button label logic:
- `isConnecting` → "Connecting..." with spinner
- `hasDiscoveredTools` → "Reconnect" with refresh icon
- else → "Connect" with plug/link icon

## Key References

| File | Role |
|------|------|
| `McpServerDetailView.tsx` | Main component (1126 lines — major rewrite) |
| `useDiscoverCapabilities.ts` | Current discover hook (DELETE, replace with useMcpServerConnect) |
| `useTriggerApprovalPolicySession.ts` | Current policy gen hook (DELETE) |
| `ApprovalPolicyGeneratorPanel.tsx` | Current policy streaming panel (DELETE) |
| `useMcpServerCredentials.ts` | Credential check hook (KEEP — used by Connect flow) |
| `EnvVarForm.tsx` | Credential form component (KEEP — used by Connect flow) |
| `useMcpServer.ts` | Data hook for fetching server (KEEP) |

## Success Criteria

- [ ] `useMcpServerConnect` hook calls the `connect` RPC
- [ ] `McpServerDetailView` has a single Connect/Reconnect button above tabs
- [ ] Credential form works in the Connect flow (same UX as before)
- [ ] Tools tab is read-only (no action bar)
- [ ] Policies tab shows pinned + auto-classified (read-only, no Generate button)
- [ ] `useTriggerApprovalPolicySession.ts` deleted
- [ ] `ApprovalPolicyGeneratorPanel.tsx` deleted
- [ ] `useDiscoverCapabilities.ts` deleted
- [ ] SDK exports updated
- [ ] No TypeScript compilation errors
- [ ] `make lint` passes (eslint-plugin-stigmer rules)

## Notes

- Follow SDK-first architecture: the hook belongs in `@stigmer/react`, not `client-apps/web`
- All visual properties through `--stgm-*` tokens
- Zero Console dependencies (no Next.js routing, no app-shell auth)
- Export hook alongside component — platform builders may want `useMcpServerConnect()` without `<McpServerDetailView />`
