# Session Notes: 2026-05-19 — Phase 3b-iii (Session 7)

## Accomplishments

- Completed Phase 3b-iii: Artifact storage, inline publishing, incremental git writeback, post-stream safety net
- 5 new files, 4 modified files, 5 new test files
- 68 new tests (303 total), typecheck clean, build clean

## New Files

| File | Lines | Tests | Purpose |
|------|-------|-------|---------|
| `shared/artifact-storage.ts` | ~170 | 20 | ArtifactStorage interface + LocalArtifactStorage + ProxyArtifactStorage + factory |
| `execute-deep-agent/inline-publisher.ts` | ~120 | 9 | Fire-and-forget file publish on tool completion, SHA-256 content hash, dedup |
| `execute-deep-agent/writeback-coordinator.ts` | ~300 | 20 | Incremental git branch/commit/push/PR with per-entry mutex |
| `execute-deep-agent/auto-publish.ts` | ~75 | 8 | Post-stream safety net scanning tool calls for missed file publishes |
| `execute-deep-agent/post-stream.ts` | ~80 | 5 | Orchestrator: drain pending → auto-publish → finalize writeback |

## Modified Files

| File | Changes |
|------|---------|
| `status-builder.ts` | Added `addArtifact()` (dedup by sandboxPath) and `addWriteBack()` (upsert by workspaceEntryName) |
| `streaming.ts` | File-modification detection on `on_tool_end`, fires inline-publisher + writeback-coordinator as background promises, returns pending promises in StreamResult |
| `setup.ts` | Creates ArtifactStorage via factory, adds `artifactStorage` + `provisionResults` to SetupResult |
| `index.ts` | Creates InlinePublisher + WriteBackCoordinator, passes to streaming, calls processPostStream, logs artifact/writeback counts |

## Design Decisions Made

- **DD-5: Incremental writeback, not batch.** Commit+push on each file-modifying tool call. PR created on first push. finalize() as safety net only. Real-time UX matching Python.
- **DD-6: Local + Proxy artifact storage only.** No direct R2 upload. Local filesystem for OSS; proxy-based presigned URL upload for cloud. Runner stays credential-light.
- **DD-7: Defer skill-aware publishing.** Individual files only. No SKILL.md directory detection or ZIP packaging. Foundation exists in proto for future.

## Architecture Notes

- InlinePublisher and WriteBackCoordinator are both fire-and-forget from the streaming loop — errors logged, never thrown, streaming never interrupted
- Post-stream orchestrator runs after stream: drains pending promises → auto-publish safety net → writeback finalize. Each step isolated by try/catch.
- Artifact dedup: Map<sandboxPath, contentHash> — re-uploads only when file content actually changes
- Writeback mutex: Promise-chain-based per-entry lock serializes git operations for concurrent tool calls
- GitHub PR creation uses native `fetch()` to GitHub REST API; token extracted from HTTPS clone URL credentials or GITHUB_TOKEN env var
- StatusBuilder mutations (addArtifact/addWriteBack) set forceNextUpdate so the next scheduled persist carries them to the UI

## Deferred to Phase 3c

- HITL interrupt/resume
- Approval policy integration
- Sub-agent concurrency limiter
- Sub-agent middleware wiring (forSubAgent() views)

## Next Session Plan

1. **Phase 3c: HITL + Approval** — implement interrupt/resume, wire approval policy, sub-agent concurrency limiter
