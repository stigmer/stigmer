# Workspace File References (Drag-to-Reference) — Phase 4

**Date**: May 29, 2026

## Summary

Implemented drag-to-reference from the workspace file tree into the session composer, wiring workspace-relative paths through the existing `workspace_file_refs` proto field into execution creation. This completes the user journey from "I see a file" to "the agent focuses on it" without requiring file uploads.

## Problem Statement

After Phase 2 (live workspace file explorer) and Phase 3 (desktop native file listing), users could browse workspace files in the tree but had no way to reference them for agent attention without manually typing paths or uploading them as attachments.

### Pain Points

- Users see files in the workspace tree but cannot signal "look at this file" to the agent
- The existing `workspace_file_refs` proto field (field 10 in `AgentExecutionSpec`) was only populated by the CLI's `--attach` flow — not available in the web/desktop console
- File uploads via `attachments` are overkill for workspace files that already exist in the agent's filesystem
- No visual feedback for referenced files in the composer UI

## Solution

A complete drag-to-reference pipeline: draggable file tree nodes emit a custom MIME type (`application/x-stigmer-file-ref`), the SessionComposer detects this MIME on drop, a dedicated `useFileReferences` hook manages the path array, a `FileReferenceChipList` renders visual chips, and the submission flow includes paths in `SessionComposerSubmitContext.workspaceFileRefs` — flowing through to `useCreateAgentExecution` which passes them to the TypeScript SDK's already-supported `workspaceFileRefs` field.

## Implementation Details

### New SDK Components

- **`useFileReferences`** — Behavior hook managing `string[]` with `add/remove/clear/dedupe`. Referentially stable return per DD-010. Zero dependencies beyond React.
- **`FileReferenceChipList`** — Styled component rendering path chips with file icon, truncated filename, full-path tooltip, and remove button. Accessible with `role="list"`, `role="listitem"`, and descriptive `aria-label` attributes.
- **`FILE_REF_MIME`** — Exported constant (`application/x-stigmer-file-ref`) enabling platform builders to create custom drag sources.

### Modified Components

- **`FileTreeNode`** — New `enableDrag?: boolean` prop (defaults `false`). When enabled on file nodes, sets `draggable="true"` and emits custom MIME payload on `dragStart`. Folders remain non-draggable. Propagates to children recursively.
- **`WorkspaceEntryFiles`** — Passes `enableDrag` to `FileTreeNode` (opted in for workspace context).
- **`SessionComposer`** — New `enableFileReferences?: boolean` prop. Drop handler routes by MIME: custom MIME goes to `useFileReferences.add()`, OS files fall through to `useAttachments.addFiles()`. Drag-over overlay shows contextual text. Chips rendered in shared zone with attachments. Submit context extended with `workspaceFileRefs`.
- **`useCreateAgentExecution`** — `CreateAgentExecutionInput` extended with `workspaceFileRefs?: string[]`, forwarded to SDK `create()`.
- **Session flow hooks** — `useNewSessionFlow`, `useSessionPageFlow`, `useSessionConversation` all forward `context.workspaceFileRefs` through their execution creation paths.

### Design Decisions

- **All workspace types supported** — Runner resolves paths post-provisioning regardless of source (local or git). Proto documentation updated to reflect this.
- **Dedicated chip UI in shared zone** — Separate state management from attachments (no upload lifecycle), but same visual position (between textarea and toolbar).
- **Opt-in drag prop** — `SkillFileBrowser` shares `FileTreeNode` but doesn't need drag, so behavior is opt-in.

## Benefits

- Zero-upload file referencing — instant, no round-trip to storage
- Consistent with CLI behavior (same proto field, same runner rendering)
- Platform builders get independently importable hook + component (headless-first)
- Backward-compatible: `enableDrag` defaults to `false`, `enableFileReferences` defaults to `true`
- 27 new unit tests covering all layers

## Impact

- **Direct users** — Can now drag files from the workspace tree to the composer to focus agent attention
- **Platform builders** — Can import `useFileReferences` + `FileReferenceChipList` independently or build custom UIs with `FILE_REF_MIME`
- **Runner** — No changes needed; already renders `workspace_file_refs` into "Referenced Files" prompt sections

## Related Work

- Phase 2: Live Workspace File Explorer (`2026-05-29-161408`)
- Phase 3: Desktop Workspace File Listing (`2026-05-29-165713`)
- Workspace Direct Action UX (`2026-05-29-174425`)

---

**Status**: Production Ready
**Timeline**: Single session implementation
