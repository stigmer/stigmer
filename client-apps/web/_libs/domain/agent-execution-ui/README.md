# @stigmer/agent-execution-ui

React components for Stigmer agent execution streaming, tool calls, and human-in-the-loop approvals.

## Install

```bash
npm install @stigmer/agent-execution-ui @stigmer/rpc-client @stigmer/protos @stigmer/theme
```

## Quick Start

```tsx
import { StigmerTransportProvider } from "@stigmer/rpc-client";
import {
  ExecutionStream,
  useAgentExecution,
} from "@stigmer/agent-execution-ui";
import "@stigmer/agent-execution-ui/styles.css";

function AgentView({ executionId }: { executionId: string }) {
  const { messages, phase } = useAgentExecution({ executionId });
  return <ExecutionStream messages={messages} phase={phase} />;
}

function App() {
  return (
    <StigmerTransportProvider serverUrl="http://localhost:8090">
      <AgentView executionId="exec-abc123" />
    </StigmerTransportProvider>
  );
}
```

## Subpath Exports

| Import                                   | Contents                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| `@stigmer/agent-execution-ui`            | All execution components, hooks, helpers                     |
| `@stigmer/agent-execution-ui/styles.css` | Pre-built Tailwind CSS (use without your own Tailwind setup) |

## Components

- `ExecutionStream` — real-time message stream with auto-scroll
- `ExecutionStatus` — lifecycle phase badge
- `MessageEntry` — renders human, AI, tool, and system messages
- `ToolCallCard` — collapsible tool call with arguments and results
- `SubAgentCard` — sub-agent delegation card with status
- `ApprovalControls` — HITL approve/deny UI for tool calls
- `MessageInput` — text input with send action
- `OutputBlock` — formatted output (markdown, code, raw)

## Hooks

- `useAgentExecution({ executionId })` — subscribes to execution events, returns messages and phase
- `useApproval({ executionId })` — handles HITL approval submissions
- `useExecutionService()` — access the execution service from context

## CSS Strategy

**Option A — Pre-built CSS** (no Tailwind required):

```typescript
import "@stigmer/agent-execution-ui/styles.css";
```

**Option B — Tailwind integration** (for full customization):

Import tokens from `@stigmer/theme` in your own Tailwind setup and let your pipeline process the classes.

## License

Apache-2.0
