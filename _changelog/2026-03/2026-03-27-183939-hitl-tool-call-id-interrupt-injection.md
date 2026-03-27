# HITL: Inject tool_call_id into Interrupt Payload via InjectedToolCallId

**Date**: March 27, 2026

## Summary

Replaced the fragile 4-tier fuzzy matching chain in the HITL approval flow with direct `tool_call_id`-based matching. Every tool wrapper now receives its `tool_call_id` via LangChain's `InjectedToolCallId` annotation, and the interrupt payload is reduced from 8 fields to 2: `{tool_call_id, message}`. This eliminates the entire class of interrupt-to-tool-call matching bugs that caused four cascading fixes in a single day.

## Problem Statement

The HITL interrupt capture pipeline relied on a fragile chain of heuristics to match LangGraph interrupts back to the tool calls that produced them:

### Pain Points

- **4-tier fuzzy matching**: `run_id` aliases, fingerprint hashing, name-based fallback, and "phase 1 enrichment" — each tier was a defense-in-depth patch over the previous one's gaps
- **`run_id` fragility**: Extracted from `RunnableConfig.run_id`, which is a LangGraph-internal detail not designed to be a stable identity
- **Sub-agent matching failures**: `from_sub_agent` metadata in interrupt payloads didn't always match Phase 1 records, requiring a second "relaxed" pass that ignored the flag
- **Redundant interrupt payload**: 8 fields (`tool_name`, `tool_args`, `message`, `mcp_server`, `source`, `from_sub_agent`, `sub_agent_name`, `run_id`) duplicating data already present on the `ToolCall` in messages
- **Cascading bugs**: Four HITL fixes landed within 24 hours, each patching symptoms of the same root cause — unreliable interrupt-to-tool-call identity

## Solution

Use LangChain's `InjectedToolCallId` annotation to inject the model-assigned `tool_call_id` directly into every tool function at invocation time. This gives each tool call a stable, unique identity that flows through the interrupt payload without any heuristic matching.

## Implementation Details

### Production Code

**`graphton/core/tool_wrappers.py`**:
- `_check_and_handle_approval` simplified: removed `mcp_server`, `from_sub_agent`, `sub_agent_name`, `run_id` params; added `tool_call_id`
- Interrupt payload: `{"tool_call_id": tool_call_id, "message": requirement.message}`
- All 5 platform tools (read, write, execute, edit, create_pull_request) updated with `tool_call_id: Annotated[str, InjectedToolCallId]`
- MCP approval wrapper updated with same annotation
- New `_build_merged_schema()`: Creates a Pydantic model merging MCP tool's schema (LLM-visible) with `InjectedToolCallId` (runtime-injected, LLM-hidden). Solves conflict where copying `args_schema` from the MCP tool would destroy injection metadata.
- New `_approval_tool_kwargs_to_actual_args()`: Strips LangChain-injected keys before unwrapping nested `kwargs`/`input` shells

**`graphton/core/git_tools.py`**:
- `create_pull_request` tool updated with `InjectedToolCallId` injection

**`agent-runner/worker/activities/graphton/hitl.py`**:
- `InterruptCapture._match_interrupt` reduced from 4-tier fuzzy matching (~135 lines) to direct `tool_call_id` validation (~30 lines)
- Removed: `_match_by_name`, `_try_enrich_phase1_entry`, run_id alias tracking, fingerprint matching
- Added: `_find_tool_call` helper for resolving display metadata from ToolCall objects
- `CheckpointFallback.discover_interrupts` updated for `tool_call_id`-based matching

### Tests

- `test_tool_wrappers.py`: 124 tests — updated all `ainvoke` calls to ToolCall format, assertions to `.content` for `ToolMessage` returns, new `TestInjectedToolCallIdValidation` class
- `test_git_tools.py`: 30 tests — same ToolCall format + assertion updates
- `test_hitl_contracts.py`: 33 tests — rewrote InterruptCapture contract tests to use `capture()` pipeline instead of removed `_try_enrich_phase1_entry`
- `test_approval_resume.py`: 12 tests — rewrote from scratch: `TestMatchInterrupt`, `TestVerifyWaitingApproval`, `TestFindToolCall`
- `test_status_builder.py`: Updated `TestTryEnrichPhase1Entry` to test `_match_interrupt` instead
- `test_integration_skill_pipeline.py`: Updated `TestToolAliasSkillReads` for ToolCall format

## Benefits

- **Single identity**: `tool_call_id` is the one and only identity for matching interrupts to tool calls — no aliases, no fingerprints, no name-based fallback
- **Eliminated ~300 lines** of fuzzy matching logic in `hitl.py`
- **Interrupt payload 75% smaller**: 2 fields instead of 8, no redundant data
- **Sub-agent matching fixed by default**: `tool_call_id` is unique across all tool calls regardless of agent hierarchy
- **No backward compatibility burden**: Clean break from `run_id` — one field, one identity

## Impact

- **Python agent-runner**: Simplified interrupt capture pipeline, smaller interrupt payloads
- **Python graphton**: All tool wrappers now carry `tool_call_id` through to approval flow
- **Test reliability**: Contract tests now verify the actual production flow (`capture()` pipeline) instead of internal helper methods

## Related Work

- Follows from T01 research documented in [HITL tool_call_id Research and Interrupt Payload Design](2026-03-27-174225-hitl-tool-call-id-research-and-interrupt-payload-design.md)
- Design decision DD-002: Minimal interrupt payload `{tool_call_id, message}`
- Unblocks T07 (test rewrites for new architecture) partially
- Next: T02 (Proto changes) to further simplify the data model

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (research in Session 1 + implementation in Session 2)
