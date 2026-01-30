# Project: 20260130.02.agent-execution-streaming-improvements

## Overview
Comprehensive improvements to AgentExecution proto contract and LangGraph streaming implementation to address data loss, incomplete event handling, streaming UX issues, and future extensibility (HITL, cancellation, limits).

**Created**: 2026-01-30

## Project Information

### Goal
Fix critical gaps in agent execution streaming and establish foundation for future features like tool approval workflows, cancellation, and execution limits.

### Timeline
2-3 weeks (phased: critical fixes first, then enhancements, then future foundation)

### Technology Stack
Protocol Buffers, Python (LangGraph/StatusBuilder), Java (gRPC handlers), Go/TypeScript (stubs)

### Project Type
Refactoring

### Affected Components
- `apis/ai/stigmer/agentic/agentexecution/v1/*.proto` - Proto contracts
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` - Python streaming
- `backend/services/agent-runner/worker/activities/execute_graphton.py` - Python activity
- `stigmer-cloud/backend/services/stigmer-service/.../agentexecution/` - Java handlers

## Architectural Context

This project originated from an architectural review that identified the following categories of issues:

### Phase 1: Critical Fixes (Data Loss/Incorrect Behavior)
1. **Missing `on_chat_model_end` handler** - No token counts, messages never finalize
2. **Event-count based updates** - Poor UX (30s waits or 10 updates/sec)
3. **Unreliable final persistence** - Data lost if final update fails

### Phase 2: Should Fix (Incomplete Design)
4. **No streaming state on messages** - Frontend can't show partial vs complete
5. **RUNNING state not used** - Tools jump PENDING → COMPLETED
6. **Sub-agent black box** - Only see input/output, not internals
7. **No token/cost tracking** - No UsageMetrics
8. **No execution context visibility** - Can't see what agent had access to

### Phase 3: Future Foundation (Extensibility)
9. **HITL approval fields** - Foundation for tool approval workflow
10. **Execution limits** - Max time, tokens, tool calls
11. **Cancellation mechanism** - Cancel running executions
12. **Delta updates** - Efficient incremental streaming (optional)

## Key Files Reference

### Proto Files
```
apis/ai/stigmer/agentic/agentexecution/v1/
├── api.proto      # AgentExecution, AgentExecutionStatus, AgentMessage, ToolCall, SubAgentExecution
├── spec.proto     # AgentExecutionSpec, ExecutionConfig
├── enum.proto     # ExecutionPhase, MessageType, ToolCallStatus, TodoStatus, SubAgentStatus
├── command.proto  # Command RPCs (create, update, updateStatus, delete)
├── query.proto    # Query RPCs (get, list, subscribe)
└── io.proto       # Request/response messages
```

### Python Files (agent-runner)
```
backend/services/agent-runner/
├── worker/activities/
│   ├── execute_graphton.py    # Main execution activity - streaming loop
│   └── graphton/
│       └── status_builder.py  # Builds status from LangGraph events
├── grpc_client/
│   └── agent_execution_client.py  # Sends status updates to stigmer-service
└── docs/
    ├── architecture/agent-execution-workflow.md
    └── CURRENT_IMPLEMENTATION.md
```

### Java Files (stigmer-cloud)
```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/
├── request/handler/
│   ├── AgentExecutionUpdateStatusHandler.java  # Handles status updates from agent-runner
│   └── AgentExecutionSubscribeHandler.java     # Real-time streaming to clients
└── redis/
    ├── AgentExecutionRedisWriter.java  # Publishes to Redis stream
    └── AgentExecutionRedisReader.java  # Reads from Redis stream
```

## Dependencies
None - self-contained improvements

## Success Criteria
- Messages have `is_streaming` flag and token counts
- Tool calls use RUNNING state properly
- Time-based streaming updates (500ms minimum)
- Sub-agent internals captured (tool calls, messages)
- `on_chat_model_end` event handled for message finalization
- UsageMetrics tracked (prompt tokens, completion tokens, model used)
- HITL foundation fields added to proto

## Known Risks
- Proto changes require stub regeneration across Go/Python/Java/TypeScript
- Backward compatibility with existing clients consuming the stream
- Frontend may need updates to handle new fields (but fields are optional)

## Status

### Current Phase
Planning and Review

### Last Updated
2026-01-30

## Quick Links
- [Next Task](next-task.md) - Drop this file into chat to resume
- [Task Plan](tasks/T01_0_plan.md) - Comprehensive implementation plan
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Reference Documentation

### Current Implementation
- `backend/services/agent-runner/docs/CURRENT_IMPLEMENTATION.md`
- `backend/services/agent-runner/docs/architecture/agent-execution-workflow.md`

### Proto Definitions
- `apis/ai/stigmer/agentic/agentexecution/v1/*.proto`

## Notes
This project follows the Next Project Framework for structured multi-day development.

To resume work: Simply drag and drop the `next-task.md` file into your conversation.
