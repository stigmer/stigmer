# Lint Cleanup Across Python and Go Codebase

**Date**: March 29, 2026

## Summary

Resolved all lint and type-check errors caught by `make check` across the graphton library, agent-runner service, and stigmer-server Go module. The full CI gate (tidy, lint, docs, builds, 1373 tests) now passes cleanly on the `feat/status-builder-hardening` branch.

## Problem Statement

After the T08 handler extraction refactor (StatusBuilder from 3,289 to 417 lines), `make check` was failing with 30+ lint errors across 13 files in three codebases: the graphton Python library, the agent-runner Python service, and the stigmer-server Go module.

### Pain Points

- Unused imports left behind after large refactors (F401)
- Import blocks out of isort order after handler extraction moved code between modules (I001)
- Uppercase local variables in functions violating PEP 8 naming (N806)
- Unused variable assignments from protobuf `.add()` calls and test scaffolding (F841)
- Unused Go import from a prior API stub removal

## Solution

Systematic fix of all ruff (Python) and go vet (Go) errors, using `ruff check --fix` for auto-fixable issues and manual edits for unsafe fixes. Preserved backward-compatible re-exports that tests depend on by using `# noqa: F401` annotations.

## Implementation Details

**Go (1 file)**:
- Removed unused `agentexecutionv1` import from `workflow_creator.go`

**Python — graphton lib (5 files)**:
- Renamed uppercase local variables `_MAIN_AGENT_ADVISORY_INTERVAL` → `main_agent_advisory_interval` in `agent.py`
- Fixed import sorting in `subagent.py` (ruff requires aliased imports in separate statements)
- Removed unused imports and variables in 3 test files

**Python — agent-runner (7 files)**:
- Fixed import ordering across `status_builder.py`, `execute_graphton.py`, and 4 handler modules (`chat_model.py`, `streaming_buffers.py`, `sub_agent.py`, `tool_event.py`)
- Removed unused `MessageType`, `Config`, `ToolCall`, and `patch` imports
- Removed unused `tc_a`/`tc_b` variable assignments in `test_status_builder.py` (protobuf `.add()` side-effect pattern)
- Preserved `_MAX_SUBJECT_LENGTH` and `_generate_sub_agent_subject` re-exports with `# noqa: F401`

## Benefits

- `make check` passes end-to-end: tidy → lint → docs → builds → 1373 tests ✅
- Branch is CI-ready for PR review
- No functional changes — all fixes are import ordering, unused symbol removal, and naming conventions

## Impact

Branch `feat/status-builder-hardening` is now clean and ready for PR. The fixes span the graphton library and agent-runner service but introduce zero behavioral changes.

---

**Status**: ✅ Production Ready
