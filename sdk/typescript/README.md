# @stigmer/client

TypeScript client for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. Provides typed API clients for every Stigmer resource with authentication, error handling, and cross-resource search.

## Installation

```bash
npm install @stigmer/client @stigmer/apis @bufbuild/protobuf
```

`@stigmer/apis` and `@bufbuild/protobuf` are peer dependencies.

## Quick Start

### Server-to-server (static API key)

```typescript
import { Stigmer } from "@stigmer/client";

const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  apiKey: "sk_live_abc123",
});

const agent = await stigmer.agent.get("agent-id");
```

### Browser / rotating credentials

```typescript
import { Stigmer } from "@stigmer/client";

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
| `run`                | Run                |
| `apiKey`             | ApiKey             |
| `grant`              | Grant              |
| `identityAccount`    | IdentityAccount    |
| `federationIssuer`   | FederationIssuer   |
| `organization`       | Organization       |
| `plugin`             | Plugin             |
| `session`            | Session            |
| `skill`              | Skill              |
| `vault`              | Vault              |
| `search`             | Cross-resource search |
| `billing`            | Billing (account, Stripe, model catalog)               |

A vault's entries are written through its entry calls, not through `create`
or `update`: `stigmer.vault.setSecrets`, `setConnection`, `removeSecrets` and
`removeConnections`. `create` starts the vault empty, and `update` changes its
name, description and external id while keeping the entries as stored.

### Billing

An organization's billing account (its Stripe customer), the Stripe portal
and card setup sessions. Token usage is read from the run client's usage
reports (`getRunUsageReport`, `getSessionUsageReport`, `getAgentUsageReport`,
`getOrgUsageReport`), counted in tokens and never priced. Queries
require `can_view_billing` on the org and the org's own billing commands
require `can_manage_billing`. The model catalog calls
(`listModelPricingBaselines`, `upsertModelPricingBaseline`,
`retireModelPricingBaseline`) require `can_manage_model_pricing` on the
platform:

```typescript
const account = await stigmer.billing.getBillingAccount(org);

const { setupUrl } = await stigmer.billing.createPaymentMethodSetupSession({
  org,
  successUrl: "https://example.com/billing?setup=success",
  cancelUrl: "https://example.com/billing",
});
```

### Common operations

```typescript
import { create } from "@bufbuild/protobuf";
import { ListAgentsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/io_pb";
import { RenameInputSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

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

// Update: name the agent by id, give the new values, and name the fields
// you changed. Every other field keeps its stored value. Sending the etag
// you read makes the save fail with "aborted" if someone changed the agent
// since.
const current = await stigmer.agent.get("agent-id");
const updated = await stigmer.agent.update(
  {
    metadata: { id: current.metadata?.id, etag: current.metadata?.etag },
    spec: { description: "Updated description" },
  },
  ["spec.description"],
);

// Rename: change the slug people type. The id stays, so everything that
// points at the agent keeps working; the old slug reads for 30 days.
const renamed = await stigmer.agent.rename(
  create(RenameInputSchema, { resourceId: "agent-id", slug: "variance-reporter" }),
);

// Delete
const deleted = await stigmer.agent.delete("agent-id");

// List: one page of the org's agents, newest first. A page carries
// nextPageToken while more follow; pageSize 0 asks for the default 50.
const page = await stigmer.agent.list(create(ListAgentsRequestSchema, { org: "my-org", pageSize: 20 }));
const next = await stigmer.agent.list(
  create(ListAgentsRequestSchema, { org: "my-org", pageSize: 20, pageToken: page.nextPageToken }),
);

// Every agent, page after page: listAll follows the tokens.
for await (const a of stigmer.agent.listAll({ org: "my-org" })) {
  console.log(a.metadata?.slug);
}

// Only the agents carrying every label given.
for await (const a of stigmer.agent.listAll({ org: "my-org", labels: { team: "finance" } })) {
  console.log(a.metadata?.slug);
}
```

### Cross-resource search

```typescript
import { ApiResourceKind } from "@stigmer/client";

const results = await stigmer.search.query({
  kinds: [ApiResourceKind.agent, ApiResourceKind.skill],
  org: "my-org",
  query: "variance report",
});
```

## Streaming

Resources with streaming RPCs return `AsyncGenerator`:

```typescript
for await (const event of stigmer.run.watch("run-id")) {
  console.log(event);
}

// With cancellation
const controller = new AbortController();
for await (const event of stigmer.run.watch("run-id", controller.signal)) {
  if (shouldStop(event)) {
    controller.abort();
  }
}
```

## Error Handling

All SDK operations throw `StigmerError` with structured error codes:

```typescript
import { StigmerError, isNotFound, isRetryable } from "@stigmer/client";

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

For a CI job or a script, use a [service account's](https://stigmer.ai/docs/guides/authentication/service-accounts) API key, not a person's: it keeps working when that person leaves and works only in its own organization.

## Local Execution

Agent runs execute in the cloud by default — the Stigmer server provisions a sandbox with a runner. To execute runs on the client (a desktop app, CLI, or self-hosted deployment), set the execution target.

### Selecting the target

```typescript
// App-level default for every session
const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  getAccessToken: () => authStore.getToken(),
  executionTarget: "local", // "local" | "cloud"; omit to let the server decide
});

// A per-call executionTarget takes precedence over the app-level default
const session = await stigmer.session.create({
  name: "q3-variances",
  org: "my-org",
  agentRef: { org: "my-org", slug: "variance-reporter" },
  executionTarget: "cloud",
});
```

### `RunnerAdapter`

For local execution, the client owns the runner lifecycle. `@stigmer/client` exports the `RunnerAdapter` type so non-React hosts (Node scripts, custom frameworks) can implement it:

```typescript
import type { RunnerAdapter } from "@stigmer/client";

const adapter: RunnerAdapter = {
  onSessionOpened: async (sessionId) => { /* start a worker for this session */ },
  onSessionClosed: async (sessionId) => { /* stop it */ },
};
```

If your runner backend already exposes `addSession` / `removeSession` (a `RunnerWorkerHost`) — the in-process `createStigmerRunnerManager`, the desktop's embedded-runner context, or your own API — skip the hand-wiring and let `createRunnerAdapter` build the adapter:

```typescript
import { createRunnerAdapter } from "@stigmer/client";

const adapter = createRunnerAdapter(myRunnerHost);
```

A Session has no terminal phase, so its worker is tied to whether the session is **open**: attach on `onSessionOpened`, detach on `onSessionClosed` (and keep both idempotent — `onSessionOpened` may fire again on re-open).

The SDK does not invoke these methods on its own in a non-React host — you wire the adapter to your own open/close code paths. In React apps, `@stigmer/react-sdk` does this wiring automatically: pass `executionTarget` and `runnerAdapter` to `StigmerProvider` and the SDK hooks invoke the adapter at the right lifecycle points.

See the [`@stigmer/react-sdk` local execution docs](../react/README.md#local-execution) and the [runner embedding guide](https://stigmer.ai/docs/guides/runners/embedding) for the full desktop (local) and web (cloud) walkthrough.

## Code Generation

The resource clients in `src/gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/typescript
make codegen
```

Handwritten code lives in `src/` (outside `src/gen/`): `config.ts`, `transport.ts`, `stigmer.ts`, `search.ts`, `index.ts`, and `internal/`.
