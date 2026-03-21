# Library Edit Flow — Modify Existing Agents, Skills, and MCP Servers

**Date**: March 20, 2026

## Summary

Added a complete edit flow for Library resources — Agents, Skills, and MCP Servers — enabling users to modify existing resources by attaching them to creator agent sessions. The implementation spans the SDK (serialization functions, programmatic attachment prop), Console (edit session URLs, SessionLauncher edit mode, edit buttons), and Seedpack (creator agent modification instructions). Zero backend changes required.

## Problem Statement

Users could create new Agents, Skills, and MCP Servers through the Library's "Create New" flow (Phase 3), but had no way to modify existing resources after creation. Editing required manual steps outside the platform — exporting YAML, modifying it, and re-applying.

### Pain Points

- No edit affordance anywhere in the Library UI — users had to know about manual YAML editing
- No mechanism to attach existing resource definitions to a session composer programmatically
- Creator agents had no instructions for handling modification vs. creation
- No way to serialize Agent/McpServer proto objects back to their canonical YAML representation

## Solution

Leveraged the existing create flow infrastructure (Phase 3) and artifact pipeline (Phase 2) to build a lightweight edit flow:

1. **Serialize** the existing resource (Agent/McpServer → YAML, Skill → download ZIP)
2. **Attach** the file to a new session with the appropriate creator agent pre-selected
3. **Creator agent reads** the attachment from `/inputs/` and enters "Modification Mode"
4. **User describes** desired changes in the message
5. **Agent produces** a complete updated resource as an artifact
6. **Existing artifact pipeline** detects, previews, and applies/pushes the result

## Implementation Details

### SDK Layer (`@stigmer/react`)

**Resource Serialization** (`serialize-resource-yaml.ts`):
- `serializeAgentYaml(agent: Agent)` — converts proto Agent to canonical snake_case YAML
- `serializeMcpServerYaml(mcpServer: McpServer)` — same for McpServer
- Handles all nested structures: `mcp_server_usages`, `sub_agents`, `env_spec`, `stdio`/`http`, resource refs, tool approval overrides
- Omits `status` field (system-managed, not part of the user-editable specification)
- Inverse of `parseResourceYaml` — the serialization/deserialization pair is now complete

**Programmatic Attachment** (`SessionComposer.tsx`):
- New `initialAttachments?: File[]` prop
- Mount-time one-shot effect following the `initialAgentRef` pattern (ref-guarded, async-safe)
- Attachment chips appear in the UI so users see what's attached
- SDK-level prop — platform builders can use it for their own edit workflows

### Console Layer (`client-apps/web`)

**Edit Session URL Utilities** (`draft-session.ts`):
- `DraftParams` interface with optional `editRef: { org, slug }`
- `getEditSessionUrl(resourceType, org, slug)` → `/?draft=agent&editOrg=acme&editSlug=my-agent`
- `parseDraftParams(searchParams)` for full draft/edit URL parsing
- Backward-compatible — existing `parseDraftParam` still works

**SessionLauncher Edit Mode** (`SessionLauncher.tsx`):
- Conditional resource fetching via `useAgent`/`useMcpServer`/`useSkill` hooks
- Agent/McpServer: serialized to YAML `File` objects using the new SDK functions
- Skill: ZIP package downloaded via `getArtifact` RPC, copied to `File` object
- Edit-mode heading ("What would you like to change?") and placeholder text
- Passed to `SessionComposer` as `initialAttachments`

**Edit Buttons**:
- `AgentDetailPage`: Dedicated "Edit" link button in the page header
- `SkillListPage` / `McpServerListPage`: `onItemClick` → edit session URL (interim until detail pages)

### Seedpack Layer

All three creator agents updated with "Modification Mode" instructions:
- **agent-creator.yaml**: Check `/inputs/` for attached YAML, read current config, apply changes, produce complete updated Agent YAML
- **skill-creator.yaml**: Check `/inputs/` for attached ZIP, extract and read structure, rewrite all files, skip scaffolding step
- **mcp-server-creator.yaml**: Same pattern for McpServer YAML modification

## Benefits

- **Users** can edit any Agent, Skill, or MCP Server from the Library with a natural conversation — describe what to change, the agent handles the rest
- **No backend changes** — leverages existing artifact pipeline (Phase 2) and create flow (Phase 3)
- **Platform builders** get the `initialAttachments` prop on `SessionComposer` for custom edit workflows
- **Creator agents** gain modification awareness through instructions alone — no code changes to the agent runtime
- **Complete serialization pair**: `serializeAgentYaml`/`serializeMcpServerYaml` complement `parseResourceYaml`

## Impact

- **Scope**: SDK (`@stigmer/react`), Console (`client-apps/web`), Seedpack (creator agent instructions)
- **Files**: 12 files changed (1 new SDK file, 11 modified), ~390 insertions, ~20 deletions
- **No breaking changes**: All new props are optional, all new exports are additive
- **All three resource types**: Agent, Skill, and MCP Server edit flows are functional

## Related Work

- **Phase 2**: Execution Artifacts Widget + Apply Flow — the artifact detection, preview, and apply/push pipeline that the edit flow's output uses
- **Phase 3**: Create New Draft Flow — the `?draft=type` URL contract, `CREATOR_AGENTS` map, and `SessionLauncher` pre-fill that the edit flow extends
- **Attachment Infrastructure**: `useAttachments` hook and `AttachmentChipList` component that `initialAttachments` builds on
- **Sub-project**: Resource Detail Views (`20260320.03.sp.resource-detail-views`) — Agent detail page already has the "Edit" button; Skill and McpServer detail pages will get theirs when built

---

**Status**: ✅ Production Ready
**Timeline**: Single session (Session 23)
