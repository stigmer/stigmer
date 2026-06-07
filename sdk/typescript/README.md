# @stigmer/sdk

TypeScript SDK for the Stigmer platform. Provides typed API clients for all Stigmer resources with authentication, error handling, and cross-resource search.

## Installation

```bash
npm install @stigmer/sdk @stigmer/protos @bufbuild/protobuf
```

`@stigmer/protos` and `@bufbuild/protobuf` are peer dependencies.

## Quick Start

### Server-to-server (static API key)

```typescript
import { Stigmer } from "@stigmer/sdk";

const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  apiKey: "sk_live_abc123",
});

const agent = await stigmer.agent.get("agent-id");
```

### Browser / rotating credentials

```typescript
import { Stigmer } from "@stigmer/sdk";

const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  getAccessToken: () => authStore.getToken(),
  onUnauthenticated: () => router.push("/login"),
});

const agents = await stigmer.agent.list({ org: "my-org" });
```

## Resource Clients

Every resource type has a typed client accessible as a property on the `Stigmer` instance:

| Property             | Resource           |
|----------------------|--------------------|
| `agent`              | Agent              |
| `agentExecution`     | AgentExecution     |
| `agentInstance`      | AgentInstance      |
| `apiKey`             | ApiKey             |
| `environment`        | Environment        |
| `executionContext`   | ExecutionContext    |
| `iamPolicy`          | IamPolicy          |
| `identityAccount`    | IdentityAccount    |
| `identityProvider`   | IdentityProvider   |
| `mcpServer`          | McpServer          |
| `organization`       | Organization       |
| `project`            | Project            |
| `session`            | Session            |
| `skill`              | Skill              |
| `workflow`           | Workflow           |
| `workflowExecution`  | WorkflowExecution  |
| `workflowInstance`   | WorkflowInstance   |
| `search`             | Cross-resource search |

### Common operations

```typescript
// Create
const agent = await stigmer.agent.create({
  name: "my-agent",
  org: "my-org",
  description: "Handles customer inquiries",
  instructions: "Be helpful and concise.",
});

// Get by ID
const agent = await stigmer.agent.get("agent-id");

// Get by reference (org + slug)
const agent = await stigmer.agent.getByReference({
  org: "my-org",
  slug: "my-agent",
});

// Update
const updated = await stigmer.agent.update({
  name: "my-agent",
  org: "my-org",
  description: "Updated description",
});

// Delete
const deleted = await stigmer.agent.delete("agent-id");

// List (search-backed)
const results = await stigmer.agent.list({
  org: "my-org",
  query: "customer",
  page: { num: 1, size: 20 },
});
```

### Cross-resource search

```typescript
import { ApiResourceKind } from "@stigmer/sdk";

const results = await stigmer.search.query({
  kinds: [ApiResourceKind.agent, ApiResourceKind.skill],
  org: "my-org",
  query: "customer support",
});
```

## Streaming

Resources with streaming RPCs return `AsyncGenerator`:

```typescript
for await (const event of stigmer.agentExecution.watch("execution-id")) {
  console.log(event);
}

// With cancellation
const controller = new AbortController();
for await (const event of stigmer.agentExecution.watch("execution-id", controller.signal)) {
  if (shouldStop(event)) {
    controller.abort();
  }
}
```

## Error Handling

All SDK operations throw `StigmerError` with structured error codes:

```typescript
import { StigmerError, isNotFound, isRetryable } from "@stigmer/sdk";

try {
  const agent = await stigmer.agent.get("nonexistent");
} catch (err) {
  if (isNotFound(err)) {
    console.log("Agent not found");
  } else if (isRetryable(err)) {
    console.log("Transient error, retry later");
  } else if (err instanceof StigmerError) {
    console.log(`Error [${err.code}]: ${err.message}`);
  }
}
```

Error codes: `not-found`, `permission-denied`, `unauthenticated`, `invalid-argument`, `already-exists`, `resource-exhausted`, `failed-precondition`, `internal`, `unavailable`, `cancelled`, `unknown`.

## Transport Protocol

The SDK supports two transport protocols. Both are supported by the Stigmer server.

```typescript
// gRPC-Web (default) — compact binary protocol
const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  apiKey: "sk_live_abc123",
});

// Connect protocol — HTTP/JSON, easier to debug with browser devtools
const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  apiKey: "sk_live_abc123",
  transport: "connect",
});
```

## Configuration

```typescript
interface StigmerConfig {
  baseUrl: string;
  apiKey?: string;                    // Static API key (mutually exclusive with getAccessToken)
  getAccessToken?: () => string | null | Promise<string | null>;  // Dynamic token provider
  onUnauthenticated?: () => void;     // Called once on UNAUTHENTICATED (code 16)
  transport?: "grpc-web" | "connect"; // Default: "grpc-web"
  executionTarget?: "local" | "cloud"; // Default execution target — see "Local Execution"
}
```

Exactly one of `apiKey` or `getAccessToken` must be provided.

## Local Execution

Agent and workflow execution runs in the cloud by default — the Stigmer server provisions a sandbox with a runner. To run execution on the client (a desktop app, CLI, or self-hosted deployment), set the execution target.

### Selecting the target

```typescript
// App-level default for every session and workflow execution
const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  getAccessToken: () => authStore.getToken(),
  executionTarget: "local", // "local" | "cloud"; omit to let the server decide
});

// A per-call executionTarget takes precedence over the app-level default
const session = await stigmer.session.create({
  name: "review",
  org: "my-org",
  agentInstanceId: "inst-abc",
  executionTarget: "cloud",
});
```

`workflowExecution.create()` accepts the same per-call `executionTarget`.

### `RunnerAdapter`

For local execution, the client owns the runner lifecycle. `@stigmer/sdk` exports the `RunnerAdapter` type so non-React hosts (Node scripts, custom frameworks) can implement it:

```typescript
import type { RunnerAdapter } from "@stigmer/sdk";

const adapter: RunnerAdapter = {
  onSessionOpened: async (sessionId) => { /* start a worker for this session */ },
  onSessionClosed: async (sessionId) => { /* stop it */ },
  onWorkflowExecutionCreated: async (executionId) => { /* start a worker */ },
  onWorkflowExecutionTerminated: async (executionId) => { /* stop it */ },
};
```

If your runner backend already exposes `addSession` / `removeSession` / `addWorkflowExecution` / `removeWorkflowExecution` (a `RunnerWorkerHost`) — the in-process `createStigmerRunnerManager`, the desktop's embedded-runner context, or your own API — skip the hand-wiring and let `createRunnerAdapter` build the adapter:

```typescript
import { createRunnerAdapter } from "@stigmer/sdk";

const adapter = createRunnerAdapter(myRunnerHost);
```

A Session has no terminal phase, so its worker is tied to whether the session is **open**: attach on `onSessionOpened`, detach on `onSessionClosed` (and keep both idempotent — `onSessionOpened` may fire again on re-open). A Workflow Execution runs to a terminal phase, so its worker is tied to create/terminate.

The SDK does not invoke these methods on its own in a non-React host — you wire the adapter to your own open/close and create/terminate code paths. In React apps, `@stigmer/react` does this wiring automatically: pass `executionTarget` and `runnerAdapter` to `StigmerProvider` and the SDK hooks invoke the adapter at the right lifecycle points.

See the [`@stigmer/react` local execution docs](../react/README.md#local-execution) and the [runner embedding guide](https://stigmer.ai/docs/guides/runners/embedding) for the full desktop (local) and web (cloud) walkthrough.

## Code Generation

The resource clients in `src/gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/typescript
make codegen
```

Handwritten code lives in `src/` (outside `src/gen/`): `config.ts`, `transport.ts`, `stigmer.ts`, `search.ts`, `index.ts`, and `internal/`.
