# Workstream C Session 1: Agent CRUD, Session Lifecycle, and Conversation Journey Integration Tests

**Date**: May 21, 2026

## Summary

Added 21 new Go integration tests across 3 files (1,193 lines) covering Agent CRUD operations, Session lifecycle management, and multi-turn conversation journey verification. These tests fill critical gaps in the integration test suite — the existing 57 test files had no tests for Agent Apply/Get/Delete or Session Create/List/Delete as standalone domain resources.

## Problem Statement

The integration test suite had extensive coverage for agent execution behavior (10 files, ~40 tests) and workflow engine tasks (~25 files), but lacked fundamental CRUD tests for the two most important resource types: Agent and Session. These resources are the building blocks that every other test indirectly depends on, but their API contracts were never verified directly.

### Pain Points

- No tests verified Agent Apply upsert semantics (by org+slug, not ID)
- No tests verified default AgentInstance auto-creation on Agent create
- No tests verified Session List pagination behavior (offset-based, page_token as page number string)
- No tests verified Session ListByAgent filtering (which actually filters by agent_instance_id despite field name)
- No tests verified Agent delete is non-cascading (instances survive)
- No tests verified Session delete is non-cascading (executions survive)
- ListBySession was never exercised in any test

## Solution

Three new test files organized by domain responsibility, each grounded in deep analysis of the proto validation rules and Java handler pipeline behavior.

## Implementation Details

### `test/integration/agent_crud_test.go` (431 lines, 9 tests)

| Test | What it verifies |
|------|-----------------|
| `TestAgent_ApplyGetDelete` | Full lifecycle with default instance queryable via AgentInstanceQuery |
| `TestAgent_Apply_Upsert_ByOrgAndSlug` | Apply is upsert by (org, slug), not by ID; same ID returned, status preserved |
| `TestAgent_Apply_PreservesStatusOnUpdate` | `default_instance_id` survives across updates (status is server-managed) |
| `TestAgent_Apply_InstructionsTooShort` | Protovalidate `min_len=10` enforcement → INVALID_ARGUMENT |
| `TestAgent_Apply_WithMcpServerRefs` | Reference normalization: empty org on mcp_server_ref filled from metadata.org |
| `TestAgent_GetByReference` | Org+slug+kind resolution, NOT_FOUND for bad slug, INVALID_ARGUMENT for empty org |
| `TestAgent_UpdateVisibility` | Private→public→private toggle via dedicated UpdateVisibility RPC |
| `TestAgent_Delete_NonCascading` | Agent deleted, default AgentInstance survives (with FGA-aware handling) |
| `TestAgent_Delete_Nonexistent` | NOT_FOUND or PERMISSION_DENIED for fabricated ID |

### `test/integration/session_lifecycle_test.go` (509 lines, 9 tests)

| Test | What it verifies |
|------|-----------------|
| `TestSession_CreateGetDelete` | Full lifecycle with field-level verification |
| `TestSession_Create_EmptyAgentInstance_ResolvesDefault` | Platform default agent resolution when agent_instance_id empty |
| `TestSession_Create_InvalidAgentInstance` | Behavioral discovery: documents whether server validates instance existence at create time |
| `TestSession_List_OffsetPagination` | Page_token as page-number string, find-by-ID across pages |
| `TestSession_ListByAgent_FiltersByInstanceId` | Documents proto/implementation field name mismatch |
| `TestSession_UpdateSubject` | Atomic update + empty string clears subject |
| `TestSession_Update_Metadata` | Custom metadata map round-trip via full Update RPC |
| `TestSession_Delete_Nonexistent` | NOT_FOUND or PERMISSION_DENIED |
| `TestSession_Delete_DoesNotCascadeExecutions` | Executions survive session deletion (provider-backed) |

### `test/integration/agent_execution_11_conversation_journey_test.go` (253 lines, 3 tests)

| Test | What it verifies |
|------|-----------------|
| `TestAgentExecution_ConversationJourney_ListBySession` | Execution list grows 1→2→3 across sequential turns; find-by-ID |
| `TestAgentExecution_ConcurrentSessions_Isolation` | Two sessions on same agent complete independently with distinct context |
| `TestAgentExecution_AutoSession_FollowUp` | Follow-up on auto-created session + ListBySession verification |

## Benefits

- 21 new tests covering previously untested CRUD operations on the two most fundamental resource types
- Proto/implementation gaps documented directly in test comments (ListByAgent field mismatch, instance existence non-validation)
- All tests follow existing codebase patterns exactly (testify, t.Cleanup, FGA dual-code acceptance, harness helpers)
- Offline tests execute in seconds; provider-backed tests use existing harness infrastructure

## Impact

- **Test coverage**: 57 → 60 integration test files (+3)
- **Net new tests**: 21 tests (9 agent CRUD + 9 session lifecycle + 3 conversation journey)
- **New RPC coverage**: ListBySession (never tested before), GetByReference, UpdateVisibility, UpdateSubject, List with pagination
- **Part of**: Workstream C (Pre-Deploy Integration Test Expansion), Session 1 of 3-4

## Related Work

- Part of project `20260521.01.pre-deploy-integration-test-expansion` (Workstream C)
- Parallel with Workstream A (TS Hydration Activity)
- Later sessions will add tool call + streaming tests (C.3) and lifecycle edge cases (C.2)

---

**Status**: Production Ready
**Timeline**: 1 session
