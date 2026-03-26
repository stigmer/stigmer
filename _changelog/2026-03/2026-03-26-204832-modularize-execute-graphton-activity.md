# Modularize execute_graphton Temporal Activity

**Date**: March 26, 2026

## Summary

Decomposed the 4,331-line `execute_graphton.py` Temporal activity into 6 new focused modules and wired the existing `hitl.py` module, reducing the orchestrator to 1,982 lines (54% reduction). Each extracted module follows the established `graphton/` package pattern: explicit dependencies via constructor/function parameters, single responsibility, no globals, independently testable.

## Problem Statement

`execute_graphton.py` was the single largest file in the agent-runner service at 4,331 lines. The core function `_execute_graphton_impl` alone spanned ~3,150 lines of sequential imperative code handling everything from environment resolution to LangGraph streaming to post-stream interrupt capture.

### Pain Points

- **AI code generation quality degradation**: The file's size exceeded effective context windows, causing agents to produce lower-quality solutions and miss modular decomposition opportunities
- **HITL module extracted but never wired**: `hitl.py` (791 lines, 4 classes, 13 tests) existed but was never integrated — the inline HITL code (~600 lines) remained duplicated
- **Merge conflicts**: Any change to agent execution logic touched the same massive file, creating serialization bottlenecks across contributors
- **Cognitive load**: Developers (human and AI) could not reason about individual concerns in isolation — environment resolution was interleaved with streaming was interleaved with post-stream validation
- **Test isolation**: Unit testing required constructing the full activity context even when exercising a single concern like prompt construction or attachment injection

## Solution

Executed a 7-phase incremental extraction plan, each phase independently valuable and syntax-verified. The existing `graphton/` package (10 modules) provided the established pattern: explicit constructor dependencies, no closure captures, no side effects beyond what's passed in.

## Implementation Details

### Phase 1: Wire existing hitl.py (~600 lines removed)

Replaced duplicated inline HITL code with calls to the already-extracted and tested classes:
- `InterruptCapture.capture()` for post-stream interrupt detection
- `ResumeReconciler.reconcile()` for tool-call status reconciliation on resume
- `CheckpointFallback.discover_interrupts()` for defense-in-depth checkpoint interrupt discovery
- Removed duplicate `_try_enrich_phase1_entry` definition, imported from `hitl.py`

### Phase 2: Extract prompt_builder.py (~300 lines, new module)

Moved all system prompt construction into `graphton/prompt_builder.py`:
- `build_workspace_prompt_section` — multi-workspace prompt assembly
- `build_referenced_files_prompt_section` — file reference injection
- `enhance_system_prompt` — consolidated 6 scattered if-blocks into a single orchestration function
- Helper functions: `_git_writeback_guidance`, `_build_single_workspace_section`, `_build_multi_workspace_section`, `_format_entry_description`
- Constants: `_RESPONSE_RULES`, `_SUB_AGENT_RULES`

### Phase 3: Extract attachments.py (~435 lines, new module)

Moved attachment handling and artifact auto-publish into `graphton/attachments.py`:
- `inject_attachments` — zip validation, extraction, workspace injection
- `auto_publish_written_files` — post-execution artifact publishing with path normalization
- `_validate_zip_for_extraction` — size and file count safety checks
- Constants: `_MAX_ZIP_FILES`, `_MAX_ZIP_EXTRACTED_SIZE`

### Phase 4: Extract environment.py (~133 lines, new module)

Moved environment variable resolution into `graphton/environment.py`:
- `resolve_environment` — handles both ExecutionContext path and legacy 3-layer fallback
- `EnvironmentResult` frozen dataclass — `merged_env_vars`, `secret_keys`, `used_legacy_merge`
- Clean boundary: accepts gRPC clients, returns pure data

### Phase 5: Extract streaming.py (~414 lines, new module)

Encapsulated the LangGraph streaming loop into `graphton/streaming.py`:
- `StreamExecutor` class with explicit constructor dependencies
- `StreamResult` frozen dataclass — `events_processed`, optional `terminal_status`
- Temporal SDK globals (`activity.heartbeat`, `activity.is_cancelled`) injected as callables for testability
- Background heartbeat task, stall detection, progressive gRPC updates, pause/cancel handling, recursion limit recovery

### Phase 6: Extract post_stream.py (~265 lines, new module)

Consolidated post-stream processing into `graphton/post_stream.py`:
- `process_post_stream` — silent completion detection, auto-publish safety net, checkpoint query/validation, interrupt capture, phase decision
- `PostStreamResult` frozen dataclass — `final_phase_name`
- Composes with `InterruptCapture` from hitl.py and `validate_against_checkpoint` from checkpoint_validator.py

### Phase 7: Extract temporal_helpers.py (~155 lines, new module)

Moved Temporal-specific utilities into `graphton/temporal_helpers.py`:
- `slim_status_for_temporal` — payload trimming for Temporal's ~2 MB limit
- `SetupTimer` — phase-level timing diagnostics
- `heartbeat_during_setup` — inter-step heartbeat delivery
- `run_sync_with_heartbeat` — async-to-sync bridge with periodic heartbeats and cancellation check

### Backward compatibility

All extracted symbols are re-exported from `execute_graphton.py` via aliased imports. Existing test files that import from the old location continue to work without modification.

## Benefits

- **54% line reduction**: 4,331 → 1,982 lines in the orchestrator file
- **14 focused modules**: The `graphton/` package grew from 10 to 14 modules, each with a single responsibility
- **AI code generation**: Smaller, focused files fit within effective context windows, improving generation quality for future changes
- **Independent testability**: Each module can be unit tested by mocking only its direct dependencies
- **Merge conflict reduction**: Changes to prompt construction, streaming, or environment resolution no longer touch the same file
- **Orchestrator clarity**: `execute_graphton.py` now reads as a linear pipeline — setup, configure, stream, post-process, finalize — with implementation details in their respective modules

## Impact

- **agent-runner service**: All changes confined to `worker/activities/execute_graphton.py` and `worker/activities/graphton/`
- **No behavior changes**: Pure refactor — same inputs, same outputs, same side effects
- **No API changes**: No protobuf, gRPC, or external interface modifications

## Related Work

- [HITL Approval Flow Hardening](2026-03-26-201753-hitl-approval-flow-hardening.md) — the extraction of `hitl.py` that established the `graphton/` package pattern and motivated this broader modularization
- `status_builder.py` (3,451 lines) is flagged as the next modularization candidate

---

**Status**: ✅ Production Ready
**Timeline**: Single session, 7 phases executed incrementally
