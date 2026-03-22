# How to Provide Secrets to Agents

## One-Sentence Positioning

**Stigmer supports two ways to provide secrets to agents: store them persistently in Environments (set up once, reuse forever), or inject them ephemerally at execution time (pass per call, deleted after).**

---

## The Two Flows

Every agent that needs credentials — an API token, a database password, an OAuth secret — gets them through one of two flows. The choice depends on your operational needs, not on whether you are a platform builder or a direct user.

### Environment Flow — Persistent Credentials

Store secrets in **Environment** resources. Bind them to agents through **AgentInstance** resources. Secrets persist across executions and are available automatically every time the agent runs.

```
Environment ──► AgentInstance ──► Session ──► AgentExecution
   (secrets)     (binding)        (context)    (run)
```

**When to use:**

- Credentials that are reused across many executions (GitHub tokens, Slack webhooks, cloud provider keys)
- Team-shared credentials where multiple agents reference the same Environment
- Users who manage their own credentials through a settings UI (personal environment pattern)
- Secret rotation without touching agent configuration — update the Environment once, all agents pick up the new value

**How it works:**

1. Create an Environment resource containing your secrets
2. Create an AgentInstance that references both the Agent blueprint and the Environment
3. Create sessions and executions — the backend resolves credentials from the AgentInstance's environment references

**React SDK:**

```tsx
import {
  useCreateEnvironment,
  useCreateAgentInstance,
  useCreateSession,
  useCreateAgentExecution,
} from "@stigmer/react";

// 1. Create an environment with secrets
const { create: createEnv } = useCreateEnvironment();
const env = await createEnv({
  name: "prod-credentials",
  org: "acme",
  data: {
    GITHUB_TOKEN: { value: "ghp_...", isSecret: true },
    LOG_LEVEL: { value: "info" },
  },
});

// 2. Create an agent instance bound to that environment
const { create: createInstance } = useCreateAgentInstance();
const instance = await createInstance({
  name: "github-bot-prod",
  org: "acme",
  agentId: "agent-abc123",
  environmentRefs: [{ org: "acme", slug: "prod-credentials" }],
});

// 3. Create a session using the instance
const { create: createSession } = useCreateSession();
const session = await createSession({
  org: "acme",
  agentInstanceId: instance.metadata.id,
});

// 4. Create executions — secrets are resolved automatically
const { create: createExecution } = useCreateAgentExecution();
await createExecution({
  org: "acme",
  sessionId: session.sessionId,
  message: "Review the latest PR",
});
```

**TypeScript SDK:**

```typescript
import { createStigmer } from "@stigmer/sdk";
const stigmer = createStigmer({ baseUrl: "..." });

const env = await stigmer.environment.create({
  name: "prod-credentials",
  org: "acme",
  data: {
    GITHUB_TOKEN: { value: "ghp_...", isSecret: true },
  },
});

const instance = await stigmer.agentInstance.create({
  name: "github-bot-prod",
  org: "acme",
  agentId: "agent-abc123",
  environmentRefs: [{ org: "acme", slug: "prod-credentials" }],
});
```

**CLI:**

CLI support for environment and agent instance management is planned. Today, environments and agent instances are managed through the Web Console or the TypeScript/React SDKs. See the Execution Flow below for CLI-supported secret injection.

### Execution Flow — Ephemeral Credentials

Pass secrets via `runtime_env` when creating an execution. Values exist for a single execution and are permanently deleted when it completes.

```
                              runtime_env
                                  │
AgentExecution ──► ExecutionContext ──► agent sandbox ──► deleted
   (created)        (merged)           (runtime)        (on completion)
```

**When to use:**

- B2B SaaS integrations where each API call injects the caller's customer credentials
- One-off secrets that should not persist beyond a single execution
- Programmatic orchestration where the calling system holds the secrets and passes them per call
- Per-execution overrides that take priority over any persistent Environment values

**How it works:**

1. Create a session (with or without an AgentInstance — both work)
2. Create an execution with `runtimeEnv` containing the secrets
3. The backend merges `runtimeEnv` at the highest priority, creates an ExecutionContext, and injects it into the agent sandbox
4. When the execution completes, the ExecutionContext (and all secrets within it) is deleted

**React SDK:**

```tsx
import {
  useCreateSession,
  useCreateAgentExecution,
} from "@stigmer/react";

const { create: createSession } = useCreateSession();
const session = await createSession({
  org: "acme",
  agentRef: { org: "acme", slug: "data-processor" },
});

const { create: createExecution } = useCreateAgentExecution();
await createExecution({
  org: "acme",
  sessionId: session.sessionId,
  message: "Process this customer's data",
  runtimeEnv: {
    CUSTOMER_API_KEY: { value: "cust_xyz...", isSecret: true },
    CUSTOMER_WORKSPACE_ID: { value: "ws-customer-abc" },
  },
});
```

**TypeScript SDK:**

```typescript
const execution = await stigmer.agentExecution.create({
  name: `exec-${Date.now()}`,
  org: "acme",
  sessionId: "ses_abc123",
  message: "Process this customer's data",
  runtimeEnv: {
    CUSTOMER_API_KEY: { value: "cust_xyz...", isSecret: true },
    CUSTOMER_WORKSPACE_ID: { value: "ws-customer-abc" },
  },
});
```

**CLI:**

```bash
stigmer run my-agent -m "Process this data" \
  --env CUSTOMER_API_KEY=cust_xyz... \
  --secret CUSTOMER_DB_PASSWORD=p4ssw0rd
```

---

## Choosing Between the Two Flows

| Consideration | Environment Flow | Execution Flow |
|---|---|---|
| **Persistence** | Secrets persist across executions | Secrets exist for one execution only |
| **Setup** | Requires creating Environment + AgentInstance resources | No setup — pass secrets at call time |
| **Credential sharing** | One Environment can be referenced by many agents | Each execution carries its own secrets |
| **Rotation** | Update the Environment once; all agents pick it up | Caller must provide new value on each call |
| **UI integration** | Full UI support: settings page, inline env forms, variable editors | Programmatic — no standard UI component |
| **Audit trail** | Environment creation/update events are tracked | Execution records which keys were injected |
| **Security model** | Secrets encrypted at rest in Environment resources; access-controlled via FGA | Secrets encrypted in ephemeral ExecutionContext; deleted on completion |
| **Best for** | Stable, reused credentials | Per-call injection, B2B SaaS, temporary tokens |

**Both flows can be active simultaneously.** An agent can receive some secrets from its Environment (persistent) and additional secrets from `runtime_env` (per-call). The merge priority ensures `runtime_env` always wins for any overlapping key.

---

## Merge Priority

When an execution starts, the backend merges all sources in this order (lowest to highest priority):

1. **Agent `env_spec.data`** — Template defaults declared in the Agent blueprint. These are schema declarations and fallback values.
2. **Environment resources** — Resolved from the AgentInstance's `environment_refs`, merged left to right. Later environments override earlier ones for shared keys.
3. **`runtime_env`** — Execution-scoped overrides passed at execution creation time. Highest priority — overrides everything.

After merging, the result is filtered by the agent's `env_spec` (whitelist). Only keys declared in the agent's `env_spec` are passed to the agent sandbox. This ensures least-privilege: a personal environment that accumulates many secrets only exposes the subset that a specific agent declared.

---

## React SDK: Hook and Component Reference

### Environment Flow

| Artifact | Layer | Purpose |
|----------|-------|---------|
| `useCreateEnvironment` | 1 | Create an Environment resource |
| `useUpdateEnvironment` | 1 | Replace an Environment's full spec |
| `useUpdateEnvironmentVariables` | 1 | Merge specific variables into an Environment |
| `useRemoveEnvironmentVariables` | 1 | Remove specific variables by key |
| `useRevealSecretValue` | 1 | Reveal a single secret value (with auto-clear) |
| `useEnvironment` | 1 | Fetch a single Environment by reference |
| `useEnvironmentList` | 1 | List Environments with label filtering |
| `useCreateAgentInstance` | 1 | Create an AgentInstance (binds Agent to Environments) |
| `useAgentInstance` | 1 | Fetch a single AgentInstance by reference |
| `useAgentInstanceList` | 1 | List AgentInstances with label filtering |
| `usePersonalEnvironment` | 2 | Managed personal environment (get-or-create, add/remove variables) |
| `usePersonalAgentInstance` | 2 | Managed personal agent instance (get-or-create) |
| `useAgentSetup` | 2 | Full agent selection + env var collection orchestration |
| `EnvironmentVariableEditor` | 1 | Self-contained variable CRUD component |
| `EnvironmentListPanel` | 1 | Accordion list with inline editors |
| `CreateEnvironmentForm` | 1 | Environment creation form |
| `AgentEnvForm` | 1 | Collect env vars from an agent's `env_spec` |
| `SessionComposer` | 2 | Full agent picker + env form + session creation |

### Execution Flow

| Artifact | Layer | Purpose |
|----------|-------|---------|
| `useCreateAgentExecution` | 1 | Create an execution with optional `runtimeEnv` |
| `useSessionConversation` | 1 | Conversation lifecycle with `runtimeEnv` support on `sendFollowUp` |

### Both Flows

| Artifact | Layer | Purpose |
|----------|-------|---------|
| `useAgentSearch` | 1 | Search agents (flow-independent) |
| `AgentPicker` | 1 | Agent selection UI (flow-independent) |
| `useCreateSession` | 1 | Create sessions (accepts `agentInstanceId` or `agentRef`) |

---

## Further Reading

- [What is an Environment?](./what-is-environment.md) — The persistent credential store
- [What is an Agent Instance?](./what-is-agent-instance.md) — How Environments are bound to Agents
- [What is an Execution Context?](./what-is-execution-context.md) — The ephemeral runtime secret carrier
- [What is an Agent Execution?](./what-is-agent-execution.md) — Where `runtime_env` is specified and secrets are resolved
