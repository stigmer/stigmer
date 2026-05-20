# Attachment Injector for ExecuteDeepAgent (Unified Runner)

**Date**: May 20, 2026

## Summary

Implemented the attachment injection module for the deep agent execution path in the unified TypeScript runner. Attachments uploaded via the CLI `--attach` flag are now downloaded from artifact storage (or read from local paths), validated for security (ZIP bomb protection, path traversal rejection), and injected into the workspace before the agent's system prompt is built. This closes a feature gap where all attachments were silently dropped.

## Problem Statement

The `Attachment` proto message on `AgentExecutionSpec` supports file inputs to agent executions, but the deep agent harness in the unified TS runner passed `injectedFiles: []` to the prompt builder — silently discarding all user-provided attachments. The Cursor harness had a minimal local-only resolver, but no ZIP handling, no cloud download, and no security validation.

### Pain Points

- Users attaching files via CLI saw them silently ignored by deep agent executions
- No ZIP extraction support meant directory attachments were unusable
- No security validation for untrusted user uploads (path traversal, zip bombs)
- `WorkspaceBackend` interface lacked binary write support (only string/UTF-8)

## Solution

Built `attachment-injector.ts` as a self-contained module in `src/activities/execute-deep-agent/` with:
- Pure `validateZipForExtraction()` function with 7 security checks
- `injectAttachments()` orchestrator with mount path collision detection, local/cloud download, and fail-hard error semantics
- Typed error classes (`AttachmentInjectionError`, `AttachmentValidationError`) with actionable messages

Extended the `WorkspaceBackend` interface with `writeFileBuffer(path, content: Buffer)` for binary content support.

## Implementation Details

### New Files
- `src/activities/execute-deep-agent/attachment-injector.ts` (320 LOC)
- `src/activities/execute-deep-agent/__tests__/attachment-injector.test.ts` (33 tests)

### Modified Files
- `src/shared/workspace/types.ts` — added `writeFileBuffer` to interface
- `src/shared/workspace/local-backend.ts` — implemented `writeFileBuffer` + extracted `ensureParentDir`
- `src/__test-utils__/mock-workspace.ts` — added mock
- `src/activities/execute-deep-agent/setup.ts` — wired injection at Step 7c
- 3 test files — added `writeFileBuffer` to inline mocks

### Key Design Decisions
- **Binary writes**: Separate `writeFileBuffer` method (not union type) — mirrors VS Code/Deno pattern, explicit semantics
- **Error handling**: Fail-hard on any attachment failure — attachments are explicit user inputs, not optional context
- **Path collision**: Reject before downloads begin — cheap check, actionable error, prevents silent data loss
- **ZIP parser**: Independent from skill-writer's parser (different trust boundaries)
- **No new dependencies**: Uses `node:zlib` (createInflateRaw) + DataView for ZIP parsing

## Benefits

- Deep agent executions now receive user-attached files as intended
- ZIP archives are safely extracted with industry-standard protections
- Binary files (images, PDFs) are handled correctly via `writeFileBuffer`
- Mount path collisions are caught early with clear error messages
- 33 new tests cover all validation paths and injection flows

## Impact

- **Users**: `--attach` now works correctly for deep agent executions (was silently broken)
- **Security**: Untrusted ZIP uploads validated against path traversal, zip bombs, null bytes
- **Platform**: `WorkspaceBackend` interface enriched for binary I/O (enables future file types)
- **Test coverage**: 961 total tests (33 new), up from 928

## Related Work

- Phase 5 Tier 6 W1: Platform Mount (prerequisite, completed prior session)
- Phase 5 Tier 6 W3: Subagent Transformer (next workstream)
- Python source: `agent-runner/activities/graphton/attachments.py` (feature parity target)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~45 min implementation + validation)
