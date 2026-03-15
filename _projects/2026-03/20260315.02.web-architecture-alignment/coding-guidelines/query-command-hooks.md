# Coding Guideline: Query/Command Hook Pattern

**Applies to**: All data-fetching and mutation hooks in Stigmer Web
**Design Decision**: [003-hook-pattern-contract](../design-decisions/003-hook-pattern-contract.md)
**Created**: 2026-03-15

---

## Architecture Overview

Every data interaction follows a three-layer pattern:

```
Layer 1: Service Factory     → domain library, pure TypeScript, no React
Layer 2: Service Hook         → domain library, binds transport from context
Layer 3: Query/Command Hook   → console only, TanStack Query
```

Domain libraries (`@stigmer/*`) own Layers 1 and 2. The console (`client-apps/web/src/`) owns Layer 3.

---

## Layer 1: Service Factories

A service factory is a pure TypeScript function that takes a `Transport` and returns a typed service interface. It has zero React dependencies and is testable in Node.js without a provider tree.

### Pattern

```typescript
// @stigmer/agent-ui/src/services/agent-query-service.ts

import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/protos/...";
import {
  AgentIdSchema,
  ListAgentsRequestSchema,
  type Agent,
  type AgentList,
} from "@stigmer/protos/...";

// --- Public types ---

export interface ListAgentsOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface AgentQueryService {
  get(id: string): Promise<Agent>;
  list(opts?: ListAgentsOptions): Promise<AgentList>;
}

// --- Factory ---

export function createAgentQueryService(
  transport: Transport,
): AgentQueryService {
  const client = createClient(AgentQueryController, transport);
  return {
    async get(id) {
      const req = create(AgentIdSchema, { value: id });
      return client.get(req) as Promise<Agent>;
    },
    async list(opts) {
      const req = create(ListAgentsRequestSchema, {
        pageSize: opts?.pageSize ?? 20,
        pageToken: opts?.pageToken ?? "",
      });
      return client.list(req) as Promise<AgentList>;
    },
  };
}
```

### Rules

1. **Interface first.** Define the `XxxService` interface before the factory. The interface is the public contract — callers depend on it, not on the implementation.

2. **Explicit parameter types.** Service methods take domain-meaningful parameters (`id: string`, `org: string`), not protobuf request objects. The factory translates parameters to protobuf internally.

3. **Errors propagate.** Service methods throw on failure. They never catch, log, or return `null`. The caller decides how to handle errors.

4. **No React imports.** Service factories must not import from `react`, `@tanstack/react-query`, or any React-specific module. They are plain TypeScript.

5. **CQRS split.** Separate `XxxQueryService` from `XxxCommandService` when read and write operations have independent consumers. Combine only when the domain workflow requires it (e.g., execution: create + subscribe).

6. **`as Promise<T>` casts.** Connect-RPC with protobuf-es codegen v1 descriptors loses generic type information. The `as Promise<T>` cast at each call site restores the correct domain type. This is a known limitation, not a type-safety violation — the underlying runtime behavior is identical.

### Naming

| Artifact | Convention | Example |
|---|---|---|
| File | `{domain}-{query\|command}-service.ts` | `agent-query-service.ts` |
| Interface | `{Domain}{Query\|Command}Service` | `AgentQueryService` |
| Factory | `create{Domain}{Query\|Command}Service` | `createAgentQueryService` |
| Options type | `{Operation}{Domain}Options` | `ListAgentsOptions` |

### Testing

Service factories are testable without React:

```typescript
import { createAgentQueryService } from "./agent-query-service";

test("get returns agent by id", async () => {
  const mockTransport = createMockTransport(/* ... */);
  const service = createAgentQueryService(mockTransport);
  const agent = await service.get("agent-123");
  expect(agent.metadata?.id).toBe("agent-123");
});
```

---

## Layer 2: Service Hooks

A service hook binds a Layer 1 factory to the transport from `StigmerTransportProvider`. It is a one-liner — no state management, no side effects.

### Pattern

```typescript
// @stigmer/agent-ui/src/services/useAgentQueryService.ts

"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createAgentQueryService,
  type AgentQueryService,
} from "./agent-query-service";

export function useAgentQueryService(): AgentQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createAgentQueryService(transport), [transport]);
}
```

### Rules

1. **One line of logic.** The hook calls `useStigmerTransport()`, passes it to the factory, and memoizes. Nothing else.

2. **Always returns non-null.** `useStigmerTransport()` throws if called outside the provider. The service is guaranteed available — no nullable return.

3. **Memoize on transport.** The factory is re-invoked only when the transport changes (which happens only when `serverUrl` changes — effectively never during a session).

4. **`"use client"` directive.** Required because the hook uses React hooks.

### Naming

| Artifact | Convention | Example |
|---|---|---|
| File | `use{Domain}{Query\|Command}Service.ts` | `useAgentQueryService.ts` |
| Hook | `use{Domain}{Query\|Command}Service` | `useAgentQueryService` |
| Return type | `{Domain}{Query\|Command}Service` (the Layer 1 interface) | `AgentQueryService` |

---

## Layer 3: Query Hooks (Console)

Console query hooks compose Layer 2 services with TanStack Query. They manage caching, loading states, error states, deduplication, and background refetching.

### Single Resource Query

```typescript
// src/hooks/agents/useAgent.ts

"use client";

import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent-ui";
import { agentKeys } from "./keys";

export function useAgent(id: string) {
  const service = useAgentQueryService();
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: () => service.get(id),
    enabled: !!id,
  });
}
```

The hook returns TanStack Query's standard result: `{ data, isLoading, isFetching, error, refetch, ... }`.

### Paginated Query (Infinite Scroll / Load More)

```typescript
// src/hooks/sessions/useSessionList.ts

"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useSessionQueryService } from "@stigmer/session-ui";
import { sessionKeys } from "./keys";

export function useSessionList(pageSize = 20) {
  const service = useSessionQueryService();
  return useInfiniteQuery({
    queryKey: sessionKeys.list({ pageSize }),
    queryFn: ({ pageParam }) =>
      service.list({ pageSize, pageToken: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
  });
}
```

The hook returns `{ data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, ... }`. Pages are accessed via `data.pages.flatMap(p => p.sessions)`.

### Search Query (with Debounce)

```typescript
// src/hooks/agents/useAgentSearch.ts

"use client";

import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent-ui";
import { useOrg } from "@/components/auth/org-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { agentKeys } from "./keys";

export function useAgentSearch(query: string) {
  const { activeOrgSlug } = useOrg();
  const debouncedQuery = useDebouncedValue(query, 300);
  const service = useAgentQueryService();

  return useQuery({
    queryKey: agentKeys.search(debouncedQuery, activeOrgSlug),
    queryFn: () => service.search(debouncedQuery, activeOrgSlug),
    enabled: !!debouncedQuery && !!activeOrgSlug,
  });
}
```

Debounce the search term, not the query function. TanStack Query deduplicates requests by key — if the debounced value hasn't changed, no new request fires.

### Composite Query (Multiple Data Sources for One View)

When a page needs data from multiple services, use separate hooks. Do not combine unrelated data into one query.

```typescript
// In a page component
function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const executions = useSessionExecutions(sessionId);

  if (session.isLoading || executions.isLoading) return <Skeleton />;
  if (session.error) return <ErrorDisplay error={session.error} />;

  return (
    <SessionDetail
      session={session.data}
      executions={executions.data}
    />
  );
}
```

Each query has its own loading state, error state, and cache lifecycle. This is intentional — if executions fail to load, the session metadata is still visible.

---

## Layer 3: Command Hooks (Console)

Command hooks use `useMutation` for write operations. They handle cache invalidation and let components control notifications.

### Pattern

```typescript
// src/hooks/agents/useCreateAgent.ts

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAgentCommandService } from "@stigmer/agent-ui";
import { agentKeys } from "./keys";
import type { CreateAgentInput } from "@stigmer/agent-ui";

export function useCreateAgent() {
  const service = useAgentCommandService();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAgentInput) => service.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}
```

### Notifications Are the Component's Responsibility

The mutation hook invalidates caches. The component decides what to tell the user:

```typescript
// In a page component
function CreateAgentPage() {
  const createAgent = useCreateAgent();
  const router = useRouter();

  function handleSubmit(input: CreateAgentInput) {
    createAgent.mutate(input, {
      onSuccess: (agent) => {
        toast.success(`Agent "${agent.metadata?.name}" created`);
        router.push(`/agents/${agent.metadata?.id}`);
      },
      onError: (err) => {
        toast.error(`Failed to create agent: ${err.message}`);
      },
    });
  }

  return (
    <AgentForm
      onSubmit={handleSubmit}
      isPending={createAgent.isPending}
      error={createAgent.error}
    />
  );
}
```

This separation is deliberate — the same mutation hook can be used in different UI contexts (a form page, a modal, a quick action) with different notification behavior.

### Delete with Confirmation

```typescript
// src/hooks/agents/useDeleteAgent.ts

export function useDeleteAgent() {
  const service = useAgentCommandService();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => service.delete(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: agentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}
```

Note `removeQueries` for the deleted resource (remove from cache entirely) vs. `invalidateQueries` for lists (refetch to reflect the deletion).

---

## Query Key Conventions

Each resource domain defines a key factory. Keys are hierarchical — invalidating a parent invalidates all children.

### Pattern

```typescript
// src/hooks/agents/keys.ts

export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (opts?: ListAgentsOptions) => [...agentKeys.lists(), opts] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
  search: (query: string, org: string) =>
    [...agentKeys.all, "search", { query, org }] as const,
};
```

### Key Hierarchy

```
["agents"]                              ← agentKeys.all (invalidates everything)
  ["agents", "list"]                    ← agentKeys.lists() (invalidates all lists)
    ["agents", "list", { pageSize: 20 }] ← agentKeys.list(opts) (specific list)
  ["agents", "detail"]                  ← agentKeys.details() (invalidates all details)
    ["agents", "detail", "abc-123"]     ← agentKeys.detail(id) (specific detail)
  ["agents", "search", { query, org }]  ← agentKeys.search(q, org)
```

### Rules

1. **One key file per domain.** `src/hooks/agents/keys.ts`, `src/hooks/sessions/keys.ts`, etc.

2. **`as const` on every key.** This makes keys readonly tuples, enabling TanStack Query's type inference for query data.

3. **Objects for multi-parameter keys.** Use `{ query, org }` instead of positional `[query, org]`. Object keys are compared by value (TanStack Query uses deep equality), and they are self-documenting.

4. **Cache invalidation granularity:**
   - Create → invalidate `xxxKeys.all` (lists need to include the new item)
   - Update → invalidate `xxxKeys.detail(id)` + `xxxKeys.lists()` (detail changed, lists may reflect it)
   - Delete → remove `xxxKeys.detail(id)` + invalidate `xxxKeys.lists()`

---

## Error Handling

Three tiers, each with a distinct responsibility.

### Tier 1: Transport Interceptors (`@stigmer/rpc-client`)

Interceptors handle cross-cutting concerns that apply to every request. They run before any application code sees the response. They must not swallow errors — they transform, annotate, or side-effect, then re-throw.

Built-in interceptors (applied in order):

1. **Auth token injection** — attaches `Authorization: Bearer <token>` header
2. **RPC metadata annotation** — annotates errors with RPC method name and path (via `WeakMap`)
3. **Error message cleanup** — strips gRPC status-code prefixes (`[internal]`) from error messages
4. **Auth redirect** — calls `onUnauthenticated` callback on UNAUTHENTICATED (code 16), once per transport

### Tier 2: Error Classification (`@stigmer/rpc-client`)

Pure TypeScript utilities for classifying errors by gRPC status code:

```typescript
import {
  classifyError,
  getUserMessage,
  isRetryableError,
  getRpcMetadata,
} from "@stigmer/rpc-client";
```

**Error category mapping:**

| gRPC Code | Category | Retryable | UX Treatment |
|-----------|----------|-----------|-------------|
| UNAUTHENTICATED (16) | `auth` | No | Redirect to login (interceptor) |
| PERMISSION_DENIED (7) | `permission` | No | Inline error |
| NOT_FOUND (5) | `not-found` | No | Inline error |
| INVALID_ARGUMENT (3), FAILED_PRECONDITION (9), OUT_OF_RANGE (11) | `validation` | No | Inline / form error |
| INTERNAL (13), UNKNOWN (2), DATA_LOSS (15) | `server` | Yes | Inline error + retry |
| UNAVAILABLE (14), DEADLINE_EXCEEDED (4), RESOURCE_EXHAUSTED (8) | `unavailable` | Yes | Inline error + retry |
| CANCELLED (1) | `cancelled` | No | Silent |
| Non-ConnectError | `unknown` | No | Inline error |

### Tier 3: Service Factories — Throw

```typescript
// Correct — let the error propagate
async get(id: string): Promise<Agent> {
  const req = create(AgentIdSchema, { value: id });
  return client.get(req) as Promise<Agent>;
}

// WRONG — never swallow errors in a service factory
async get(id: string): Promise<Agent | null> {
  try {
    const req = create(AgentIdSchema, { value: id });
    return client.get(req) as Promise<Agent>;
  } catch {
    return null;  // caller loses all error context
  }
}
```

### Query Errors: Inline Display

TanStack Query catches thrown errors and exposes them via `{ error }`. Use the `<ErrorMessage>` component for inline display:

```typescript
import { ErrorMessage } from "@/components/ui/error-message";

function AgentDetailPage({ id }: { id: string }) {
  const { data: agent, isLoading, error, refetch } = useAgent(id);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage error={error} retry={refetch} />;

  return <AgentDetail agent={agent} />;
}
```

`ErrorMessage` classifies the error, shows a category-appropriate title and message, and offers a "Retry" button for retryable errors (server/unavailable).

### Mutation Errors: Toast Notifications

Mutations use `sonner` toast for user feedback. The component controls the notification — not the hook:

```typescript
import { toast } from "sonner";
import { getUserMessage } from "@stigmer/rpc-client";

function handleCreate(input: CreateAgentInput) {
  createAgent.mutate(input, {
    onSuccess: (agent) => {
      toast.success(`Agent "${agent.metadata?.name}" created`);
      router.push(`/agents/${agent.metadata?.id}`);
    },
    onError: (err) => {
      toast.error(getUserMessage(err, "Failed to create agent"));
    },
  });
}
```

### Smart Retry Configuration

The `QueryClient` uses `isRetryableError` to avoid retrying deterministic failures:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (!isRetryableError(error)) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
```

Only `server` and `unavailable` errors are retried once. Auth, permission, not-found, and validation errors fail immediately. Mutations are never retried (not idempotent by default).

---

## Streaming Hooks: Exception to TanStack Query

Streaming hooks (gRPC server streaming, SSE) do not fit TanStack Query's request/response model. They use manual state management.

### When to Use a Custom Hook

- The data source is a **stream** (server-sent events, gRPC streaming)
- The hook manages a **persistent connection** with lifecycle (connect, reconnect, abort)
- The data model is **latest snapshot**, not cached response

### Reference Implementation

`useAgentExecution` in `@stigmer/agent-execution-ui` is the canonical streaming hook. Its pattern:

1. `AbortController` for stream lifecycle management
2. `useState` for the latest snapshot (`execution`)
3. `useCallback` for `subscribe` (starts/restarts the stream)
4. `useEffect` for initial subscription and cleanup
5. Terminal state detection to stop the stream

Custom streaming hooks live in domain libraries (Layer 2), not the console, because embeddable components need them.

---

## File Organization

### Domain Libraries (Layers 1-2)

```
_libs/domain/{domain-name}/
  src/
    services/
      {domain}-query-service.ts       ← Layer 1: factory + interface
      {domain}-command-service.ts     ← Layer 1: factory + interface
      use{Domain}QueryService.ts      ← Layer 2: service hook
      use{Domain}CommandService.ts    ← Layer 2: service hook
    hooks/
      use{CustomHook}.ts              ← streaming or embeddable-component hooks
    components/
      ...                             ← UI components (accept data via props)
    index.ts                          ← public API barrel export
```

### Console (Layer 3)

```
src/hooks/
  agents/
    keys.ts                           ← query key factory
    useAgent.ts                       ← single resource query
    useAgentList.ts                   ← paginated query
    useAgentSearch.ts                 ← search query
    useCreateAgent.ts                 ← create mutation
    useDeleteAgent.ts                 ← delete mutation
  sessions/
    keys.ts
    useSession.ts
    useSessionList.ts
    useAgentSessionList.ts
  skills/
    keys.ts
    useSkill.ts
  mcp-servers/
    keys.ts
    useMcpServer.ts
```

---

## TanStack Query Provider Setup

The `QueryClientProvider` wraps the application inside the existing provider tree:

```typescript
// src/components/auth/Providers.tsx

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isRetryableError } from "@stigmer/rpc-client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (!isRetryableError(error)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

// Provider tree order:
// ThemeProvider → AuthProvider → AuthGuard → QueryClientProvider
//   → StigmerTransportBridge → OrgProvider → children → Toaster
```

- `staleTime` of 30 seconds prevents refetching on every mount while keeping data fresh
- Smart retry: only transient errors (server/unavailable) retry once; auth/permission/validation fail immediately
- Mutations never retry (not idempotent by default)
- `<Toaster />` from sonner is placed last — receives theme from `ThemeProvider`, available to all components

---

## Anti-Patterns

### 1. Notifications in Domain Hooks

```typescript
// WRONG — domain hooks must not trigger notifications
export function useAgentQueryService() {
  const transport = useStigmerTransport();
  const { toast } = useNotifications(); // ← violates domain purity
  // ...
}
```

Notifications are the component's responsibility. Domain hooks are UI-agnostic.

### 2. Module-Level Transport

```typescript
// WRONG — deprecated pattern, do not use for new code
import { transport } from "@/services/transport";
const client = createClient(AgentQueryController, transport);
export async function getAgent(id: string) { /* ... */ }
```

All new services use context-based transport via `useStigmerTransport()`. The module-level singleton in `src/services/transport.ts` is deprecated and will be removed during migration.

### 3. Nullable Service Returns

```typescript
// WRONG — service hooks must not return null
export function useAgentQueryService(): AgentQueryService | null {
  const transport = useContext(StigmerTransportContext);
  if (!transport) return null; // ← forces null checks everywhere
  // ...
}
```

`useStigmerTransport()` throws if called outside the provider. The service is always available or the app crashes at startup with a clear error — there is no partial state.

### 4. Catching Errors in Service Factories

```typescript
// WRONG — service factories must not swallow errors
async get(id: string): Promise<Agent | null> {
  try {
    return client.get(req) as Promise<Agent>;
  } catch (err) {
    console.error("Failed to get agent", err);
    return null; // ← caller loses error type, message, and stack
  }
}
```

Throw. Let TanStack Query or the component handle it.

### 5. State Management in Service Hooks

```typescript
// WRONG — service hooks are binding-only, no state
export function useAgentQueryService() {
  const transport = useStigmerTransport();
  const [isLoading, setIsLoading] = useState(false); // ← belongs in Layer 3
  // ...
}
```

Service hooks bind transport to the factory. State management (loading, error, data) belongs in Layer 3 query/command hooks.

### 6. TanStack Query in Domain Libraries

```typescript
// WRONG — domain libraries must not depend on TanStack Query
// @stigmer/agent-ui/src/hooks/useAgent.ts
import { useQuery } from "@tanstack/react-query"; // ← breaks embeddability
```

TanStack Query is a console-level dependency. Domain libraries export service factories and service hooks. Embeddable components accept data via props.

---

## Checklist for New Hooks

When adding a new data interaction:

- [ ] Layer 1: Service factory exists with explicit interface
- [ ] Layer 1: All parameters are explicit (no React context access)
- [ ] Layer 1: Errors propagate (no try/catch)
- [ ] Layer 2: Service hook exists, returns non-null, memoized on transport
- [ ] Layer 3: Query/command hook uses TanStack Query
- [ ] Layer 3: Query key is defined in the domain's `keys.ts`
- [ ] Layer 3: Mutations invalidate the correct cache keys
- [ ] Layer 3: Org is read from context (not passed by components)
- [ ] No notifications in hooks — components handle UX feedback
- [ ] Streaming? Use custom hook pattern, not TanStack Query
