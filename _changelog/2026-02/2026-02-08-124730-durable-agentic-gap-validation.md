# Durable Agentic Workflows Gap Validation

**Date**: February 8, 2026

## Summary

Validated the research report's gap analysis for "Durable Agentic Workflows" against the actual Stigmer codebase. Confirmed that 8 of 9 identified durability gaps exist and created a prioritized implementation roadmap to make Stigmer a truly durable agentic workflow platform.

## Problem Statement

Stigmer aims to be a "durable agentic workflow" platform, but the research report identified potential gaps in the Temporal-LangGraph integration boundary. Before implementing fixes, we needed to validate which gaps actually exist in the codebase.

### Pain Points

- Research was based on general architectural patterns, not verified against actual code
- Needed clarity on what foundation already exists vs what needs building
- Required prioritization based on real implementation state

## Solution

Conducted a systematic validation of all 9 gaps from the research report by exploring the actual codebase:

1. **Agent Executor Analysis**: Examined heartbeat implementation, checkpoint handling, retry behavior
2. **Tool Execution Analysis**: Reviewed MCP integration, idempotency mechanisms, tool wrapping
3. **Workflow Engine Analysis**: Inspected Temporal integration, Signal-With-Start, lifecycle controls

## Implementation Details

### Validation Methodology

Used parallel exploration tasks to examine three areas simultaneously:
- Agent executor implementation (Python activities + Java/Go workflows)
- Tool execution layer (MCP wrappers, platform tools)
- Workflow engine (Temporal integration, durability features)

### Key Discovery: Defensive Workaround

Activity retries are **disabled** in `InvokeAgentExecutionWorkflowImpl.java`:
```java
.setMaximumAttempts(1)  // "agent execution not idempotent"
```

This means the system fails instead of recovering from crashes - a workaround, not true durability.

### Gap Validation Results

| Gap | Research Claim | Actual State | Verdict |
|-----|----------------|--------------|---------|
| A1: Durable Agent Sessions | Missing checkpoint resume | Heartbeats exist but no checkpoint_id, no retry resume | CONFIRMED |
| A2: Tool Idempotency | Missing idempotency keys | No tool ledger, retries disabled as workaround | CONFIRMED |
| A3: Pause Propagation | Missing pause/resume | Cancel/Terminate exist, Pause missing | PARTIAL |
| B1: Signal-With-Start | Not implemented | Standard SignalWorkflow only | CONFIRMED |
| B2: Event Dedupe | Not implemented | No ingress gateway or dedupe store | CONFIRMED |
| B3: Human Tasks | Basic approval only | HITL approval works, no SLAs/escalation | PARTIAL |
| B4: Workflow Versioning | Not implemented | No version pinning | CONFIRMED |
| B5: Saga/Compensation | Not implemented | No compensation stack | CONFIRMED |
| B6: Wait Semantics | Limited | Proto caps to int32 seconds | CONFIRMED |

### Existing Foundation Confirmed

- Continue-As-New: Production-ready at ~10K events
- Claim Check: Production-ready for payloads >50KB
- LangGraph Checkpointer: Working with MongoDB/SQLite backends
- HITL Approval Flow: Working with signal-based interrupt/resume
- Heartbeats: Sent every 2 seconds during agent execution

### Implementation Roadmap Created

**Phase 0 (Category-Defining)**:
- Gap A1: Add checkpoint_id to heartbeat, implement retry resume
- Gap A2: Build tool call ledger with idempotency keys

**Phase 1 (Production Reliability)**:
- Gap B1: Signal-With-Start for race-proof events
- Gap B2: Event correlation and dedupe

**Phase 2 (Enterprise Features)**:
- Gaps B3-B6: Human tasks, versioning, sagas, wait semantics

## Benefits

- Clear understanding of what exists vs what needs building
- Prioritized roadmap based on actual implementation state
- Identified the critical path (A1 + A2) to enable true durability
- Foundation confirmed ready to build on

## Impact

**Engineering**: Clear implementation targets with specific file paths and code locations identified
**Product**: Validated path to truthfully claim "durable agentic workflows"
**Timeline**: Phase 0 unlocks the category claim; subsequent phases add enterprise features

## Related Work

- Research report: `research.making-stigmer-fully-durable-agentic/04.report.gpt.md`
- Implementation plan: `plans/durable_agentic_gaps_validation_6b7f2afa.plan.md`
- Project: `_projects/2026-02/20260208.01.durable-agentic-workflows/`

---

**Status**: Analysis Complete - Ready for Implementation
**Timeline**: Analysis completed in one session
