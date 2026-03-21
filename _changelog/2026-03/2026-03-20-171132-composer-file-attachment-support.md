# File Attachment Support in SessionComposer

**Date**: March 20, 2026

## Summary

Added file attachment support to the `SessionComposer` component in `@stigmer/react`, enabling users to attach files to agent executions via the web console. The backend, proto definitions, and TypeScript SDK already fully supported attachments (used by the CLI's `--attach` flag) -- this change closes the frontend gap by threading file upload through the React SDK hook chain and adding UI controls to the composer.

## Problem Statement

The CLI supported file attachments via `--attach` since the Artifact Lifecycle feature, but the web console had no way to attach files. Users who needed to provide input data, configuration files, or reference documents to their agents had to use the CLI.

### Pain Points

- No file attachment UI in the web session composer
- The `SessionComposerSubmitContext` had no concept of attachments
- The React hooks (`useCreateAgentExecution`, `useSessionConversation`) did not thread the `attachments` field through to the SDK's execution creation, despite the SDK already accepting it
- Platform builders embedding Stigmer had no hook for managing file upload state

## Solution

Built a headless-first attachment module in `@stigmer/react` following the three-layer SDK pattern:

1. **Behavior hook** (`useAttachments`) -- manages the full file lifecycle: validation, immediate upload via `stigmer.agentExecution.uploadAttachment()`, abort-on-remove, error handling with retry, and producing `AttachmentInput[]` for execution creation
2. **Styled component** (`AttachmentChipList`) -- renders compact file chips with three visual states (uploading, ready, error) plus remove and retry actions
3. **Composer integration** -- paperclip toolbar button, drag-and-drop overlay on the textarea, and attachment chips between the context chips and toolbar

## Implementation Details

### New module: `sdk/react/src/attachment/`

- `attachment-utils.ts` -- content-type detection mirroring the CLI's `detectContentType`, file size formatting, and 10 MB size validation
- `useAttachments.ts` -- behavior hook with `addFiles`, `removeEntry`, `retryEntry`, `clear`, and `toAttachmentInputs()`. Files are uploaded immediately on selection using `File.arrayBuffer()` -> `Uint8Array` -> `uploadAttachment` RPC. Each entry tracks phase (`uploading` | `ready` | `error`), abort controllers for cancellation, and the resulting `storageKey`
- `AttachmentChipList.tsx` -- accessible chip list with `role="list"`, per-chip `aria-label` with filename and size, and labeled action buttons
- `index.ts` -- barrel exports for all public types

### Hook chain threading

- `SessionComposerSubmitContext` gained `attachments?: AttachmentInput[]`
- `SessionComposer` gained `enableAttachments` (default `true`) and `onAttachmentValidationError` props
- `CreateAgentExecutionInput` gained `attachments?: AttachmentInput[]`, threaded to the SDK's `create()` call
- `SendFollowUpOptions` gained `attachments?: AttachmentInput[]`, forwarded through `useSessionConversation`
- Console pages (`SessionPage`, `SessionLauncher`) pass `context?.attachments` through

### UX patterns

- Click paperclip icon or drag files onto the composer card to attach
- Files upload immediately (optimistic) so the `storageKey` is ready at submit time
- Oversized files (> 10 MB) rejected with a descriptive error via `onAttachmentValidationError`
- Failed uploads show error state with inline retry link
- Attachments cleared automatically after successful submit

## Benefits

- Web console users can now attach files to agent executions, matching CLI parity
- Platform builders get a headless `useAttachments` hook for custom attachment UI
- The styled `AttachmentChipList` is independently importable for drop-in use
- All new code follows SDK-first principles: zero Console dependencies, themeable via `--stgm-*` tokens

## Impact

- **Direct users**: Can now attach data files, configs, and documents via the web console
- **Platform builders**: Can import `useAttachments` for file upload state management and optionally use `AttachmentChipList` for styled rendering
- **SDK surface**: 4 new exports (`useAttachments`, `AttachmentChipList`, utility functions), 2 extended types (`SessionComposerSubmitContext`, `CreateAgentExecutionInput`), 2 new props on `SessionComposer`

## Related Work

- Artifact Lifecycle feature (CLI `--attach`, proto `AgentExecutionSpec.attachments`)
- `ArtifactCard` component (output side -- downloads and detection)
- Unified `SessionComposer` component (context pickers, model selector)

---

**Status**: Production Ready
