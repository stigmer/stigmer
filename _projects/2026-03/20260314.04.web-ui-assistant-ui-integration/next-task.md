# Next Task: 20260314.04.web-ui-assistant-ui-integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Web UI — AG-UI Protocol + Rendering Library Evaluation

**Description**: Evaluate AG-UI as the execution rendering event protocol for Stigmer's web console, with CopilotKit React UI or assistant-ui as the rendering layer. AG-UI events coexist alongside Stigmer's existing AgentExecution protobuf aggregate — two layers serving different purposes.

**Goal**: Determine whether AG-UI + CopilotKit/assistant-ui is the right rendering foundation, build a POC, and make a go/no-go decision.

**Tech Stack**: TypeScript / React 19 / Next.js 16 / AG-UI protocol / CopilotKit React UI / assistant-ui (fallback) / Connect-RPC (gRPC-Web) / Protobuf / TailwindCSS v4 / shadcn-ui

**Components**: `client-apps/web` (execution components), `apis/ai/stigmer/agentic/agentexecution/v1/` (protos), Agent Runner (Python/LangGraph)

## Task Plan

| Task | Title | Status |
|------|-------|--------|
| **T01** | Research Spike — AG-UI Protocol + UI Library Evaluation | 📋 PENDING REVIEW |
| **T02** | Implement AG-UI Event Emission in Agent Runner (if T01 = go) | ⏸️ BLOCKED on T01 |
| **T03** | AG-UI Event Storage + Streaming in Stigmer Server (if T01 = go) | ⏸️ BLOCKED on T02 |
| **T04** | Frontend Integration — CopilotKit/assistant-ui + Custom Components | ⏸️ BLOCKED on T03 |
| **T05** | Reduce AgentExecution Aggregate (remove rendering data) | ⏸️ BLOCKED on T04 |
| **T06** | Library Extraction & Packaging (@stigmer/...-adapter) | ⏸️ BLOCKED on T05 |

## Core Architectural Decision: Two-Layer Model

### The Principle

AG-UI events and AgentExecution protobuf serve DIFFERENT purposes and COEXIST:

| Layer | Purpose | Produced By | Stored By | Consumed By |
|-------|---------|-------------|-----------|-------------|
| **AgentExecution** (protobuf) | Queryable aggregate — phase, usage, pending approvals, artifacts | Agent Runner (Python) | Stigmer Server | Backend queries, CLI, platform operations |
| **AG-UI Events** (event stream) | Rendering stream — messages, tool calls, thinking, streaming | Agent Runner (Python) | Stigmer Server | Frontend (CopilotKit/assistant-ui) |

### Critical: Agent Runner Owns Execution Semantics

The Agent Runner (Python/LangGraph) derives BOTH outputs:
- It emits AG-UI events (via LangGraphAGUIAgent) for frontend rendering
- It sends AgentExecution status updates (phase, usage, pending_approvals) for the aggregate

The Stigmer Server is a control plane — it stores and forwards. It does NOT interpret AG-UI events or project them into AgentExecution aggregates. The Runner understands execution semantics; the Server does not.

### Data Flow

```
Agent Runner (Python/LangGraph)
  ├── LangGraphAGUIAgent → AG-UI events (rendering stream)
  ├── AgentExecution status updates (phase, usage, pending_approvals, etc.)
  │
  └── Both sent to Stigmer Server via gRPC

Stigmer Server (Go) — Control Plane (store + forward)
  ├── Stores AG-UI events (append-only log)
  ├── Stores/updates AgentExecution aggregate (as received from Runner)
  ├── Streams AG-UI events to subscribed frontends (gRPC-Web)
  └── Serves AgentExecution via query/command RPCs

Frontend (Browser)
  ├── AG-UI events → CopilotKit/assistant-ui renders execution timeline
  ├── AgentExecution aggregate → phase banners, sub-agent tree, cost
  └── Stigmer custom components for execution-specific UI
```

### What Stays in AgentExecution (Reduced Aggregate)

- metadata (name, id, org, labels)
- spec (session_id, agent_id, message, config)
- status.phase, status.usage, status.error
- status.started_at, status.completed_at
- status.artifacts, status.pending_approvals, status.todos
- status.resolved_context, status.context_info
- status.sub_agent_executions (metadata only: id, name, status, usage)

### What Moves to AG-UI Event Stream

- Message content (text, streaming tokens)
- Tool call arguments and results
- Thinking/reasoning blocks
- All rendering-level detail

## Prior Analysis (Context for Resume)

### Libraries Evaluated

A ChatGPT Deep Research report evaluated 10+ libraries. Key findings:

| Library | Verdict |
|---------|---------|
| **CopilotKit / AG-UI** | Top pick for AG-UI native rendering. React UI package is MIT/free. |
| **assistant-ui** | Strong fallback. ExternalStoreRuntime for custom backends, shadcn-native. |
| **Vercel AI SDK** | Headless hooks only, build all UI yourself. Third option. |
| **PI mono web-ui** | Rejected — Lit Web Components, client-side agents, different architecture |
| **Open WebUI** | Rejected — Svelte, branding license restrictions |
| **Stream Chat** | Rejected — proprietary license |
| **Chainlit** | Rejected — coupled to Chainlit backend |
| **Chatscope, NLUX, Chatbot UI** | Rejected — stale, licensing, or app-not-library |

### Why AG-UI Over Custom Adapter

- LangGraph already has `LangGraphAGUIAgent` (one conversion step, not two)
- CopilotKit React UI natively consumes AG-UI events
- Incremental event streaming vs. full-snapshot polling (bandwidth efficiency)
- Industry-aligned protocol (17 event types, open spec)
- The current `subscribe` RPC sends full AgentExecution on every update — AG-UI events are O(1) per update

### Custom Components Stigmer Must Build (Regardless of Library)

- **Execution phase banner** (PENDING → IN_PROGRESS → WAITING_FOR_APPROVAL → ...)
- **Sub-agent tree** (nested execution tree, expandable/collapsible)
- **Approval gate UX** (approve/skip/reject with execution gating)
- **Artifact viewers** (diffs, code preview, file download)
- **Replay controls** (time-based playback from stored events)
- **Per-message/tool cost attribution** (beyond thread-level totals)
- **Thinking/reasoning blocks** (collapsible, shimmer during streaming)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/checkpoints/
```

### 2. Current Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/tasks/T01_0_plan.md
```

### 3. Deep Research Report
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/research.ai-chat-ui-landscape/04.report.gpt.md
```

### 4. Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/README.md
```

## Knowledge Folders

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.04.web-ui-assistant-ui-integration/dont-dos/
```

## Stigmer Codebase Reference

### Execution Protos (the aggregate model)
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/
```
Key files: `api.proto` (AgentExecution, AgentExecutionStatus), `message.proto` (AgentMessage, ToolCall), `subagent.proto` (SubAgentExecution), `enum.proto` (ExecutionPhase, ToolCallStatus, MessageType), `query.proto` (subscribe RPC), `command.proto` (create, approve, cancel)

### Existing Web Execution Components (may be replaced)
```
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/components/execution/
```
Key files: ExecutionStream.tsx, MessageEntry.tsx, ToolCallCard.tsx, SubAgentCard.tsx, ApprovalControls.tsx

### Execution Service (gRPC-Web client)
```
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web/src/services/execution-service.ts
```

### Agent Runner (produces execution data)
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Read the Deep Research report if unfamiliar with landscape analysis
7. [ ] Continue with the next task

## Current Status

**Created**: 2026-03-14
**Updated**: 2026-03-15
**Current Task**: T01 (Research Spike — AG-UI + UI Library Evaluation)
**Status**: Plan updated with two-layer architecture, pending developer review

## Quick Commands

- "Continue with T01" — Start the research spike
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*Drag this file into any chat to resume work on this project.*
