# Design Decision 003: Hook Pattern Contract

**Date**: 2026-03-15
**Status**: Accepted
**Task**: T06 (Phase 4)
**Scope**: Service layer architecture, data fetching hooks, command hooks, error handling, caching, transport unification

---

## Context

Stigmer Web's current hooks follow an ad-hoc pattern. Each hook independently manages `useState` for data, loading, and error. Services create gRPC clients at module level using a singleton transport. There is no caching, no request deduplication, no automatic refetching, and no standardized return shapes.

The T01 plan proposed adopting Planton Web's Query/Command hook pattern — where domain library hooks return `{ query: { get, list } }` and `{ command: { create, update, delete } }` objects, and a `usePlantonService()` context bundles RPC client creation, page loading, notifications, and org/env info into a single dependency.

After analyzing Planton's implementation against Stigmer's domain and the mandates in `_roles/001_architect.md` (domain purity), `_roles/004_web_ux_ui.md` (platform-for-platforms, embeddability), and the existing patterns already proven in `@stigmer/agent-execution-ui`, this decision departs from copying Planton directly. Planton's approach has architectural weaknesses that Stigmer should not inherit.

### Current State

**Hooks** (9 total in `src/hooks/`): Each manages its own `useState` triplet (`data`, `isLoading`, `error`). Return shapes are inconsistent — `useAgentDetail` returns `{ agent, isLoading, error, refresh }` while `useSessions` returns `{ sessions, isLoading, error, hasMore, isLoadingMore, loadMore, refresh }`. Error handling is uniform (`err instanceof Error ? err.message : "fallback"`) but lives in every hook independently.

**Services** (7 files in `src/services/`): Each creates a gRPC client at module level via `createClient(ServiceDescriptor, transport)` where `transport` is a singleton from `transport.ts`. Services export bare functions that call the client and return the result. Errors propagate to the caller.

**Domain library** (`@stigmer/agent-execution-ui`): Uses a different, cleaner pattern — a `createExecutionService(transport)` factory function that returns a typed `ExecutionService` interface, and a `useExecutionService()` hook that binds it to transport from React context. This is the pattern to standardize on.

**Transport split**: Console services use a module-level singleton transport. Domain libraries use context-based transport via `StigmerTransportProvider`. These must be unified.

### Planton's Pattern (Reference Analysis)

Planton's domain hooks (e.g., `useOrganizationCommand`, `useStateBackendQuery`) follow this structure:

1. Call `usePlantonService()` to get `{ createRpcClient, setPageLoading, openNotification, envInfo, createNotificationErrorDetails }`
2. Call `useRpcClient(ServiceDescriptor)` to get a nullable `Client<T> | null`
3. Use `useState` + `useMemo` + `useEffect` to build a `query` or `command` object when the client becomes available
4. Each method in the object wraps the RPC call with `setPageLoading(true/false)`, success/error notifications, and error detail construction
5. Return `{ query }` or `{ command, defaultState? }`

This produces ~80-100 lines per hook of near-identical boilerplate.

---

## Decision

### Three-Layer Service Architecture

```
Layer 1: Service Factories    (domain libraries, pure TypeScript)
Layer 2: Service Hooks         (domain libraries, minimal React)
Layer 3: Query/Command Hooks   (console only, TanStack Query)
```

**Layer 1 — Service Factories**

Pure TypeScript functions with zero React dependency. A factory takes a `Transport` and returns a typed service interface. Testable in isolation without any React rendering.

```typescript
// @stigmer/agent-ui/src/services/agent-service.ts

export interface AgentQueryService {
  get(id: string): Promise<Agent>;
  getByReference(org: string, slug: string): Promise<Agent>;
  list(opts?: ListOptions): Promise<AgentList>;
}

export function createAgentQueryService(transport: Transport): AgentQueryService {
  const client = createClient(AgentQueryController, transport);
  return {
    async get(id) {
      const req = create(AgentIdSchema, { value: id });
      return client.get(req) as Promise<Agent>;
    },
    async getByReference(org, slug) {
      const req = create(AgentReferenceSchema, { org, slug });
      return client.getByReference(req) as Promise<Agent>;
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

This pattern is already proven by `createExecutionService()` in `@stigmer/agent-execution-ui`.

**Layer 2 — Service Hooks**

Minimal React hooks that bind a service factory to the transport from `StigmerTransportProvider`. The hook is a one-liner — no state management, no side effects, just memoized factory invocation.

```typescript
// @stigmer/agent-ui/src/services/useAgentQueryService.ts

export function useAgentQueryService(): AgentQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createAgentQueryService(transport), [transport]);
}
```

This pattern is already proven by `useExecutionService()` in `@stigmer/agent-execution-ui`.

**Layer 3 — Query/Command Hooks**

Console-level hooks that compose Layer 2 services with TanStack Query for state management, caching, deduplication, and automatic refetching.

```typescript
// Console: src/hooks/agents/useAgent.ts

export function useAgent(id: string) {
  const service = useAgentQueryService();
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: () => service.get(id),
    enabled: !!id,
  });
}
```

```typescript
// Console: src/hooks/agents/useAgentList.ts

export function useAgentList(opts?: ListOptions) {
  const service = useAgentQueryService();
  return useInfiniteQuery({
    queryKey: agentKeys.list(opts),
    queryFn: ({ pageParam }) =>
      service.list({ ...opts, pageToken: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
  });
}
```

```typescript
// Console: src/hooks/agents/useCreateAgent.ts

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

### TanStack Query — Console Level Only

TanStack Query (`@tanstack/react-query`) is adopted at the console level. Domain libraries (`@stigmer/*`) do not depend on it.

- **Console**: Uses `useQuery`, `useMutation`, `useInfiniteQuery` for all page-level data fetching.
- **Domain libraries**: Export service factories (Layer 1) and service hooks (Layer 2) only. UI components accept data via props.
- **Embeddable components**: Host applications use whichever data fetching library they prefer (TanStack Query, SWR, Apollo, manual fetch). The service factory is the integration point — call `createAgentQueryService(transport)` and wire the result into whatever state management the host uses.

### Query Key Conventions

Each resource domain defines a key factory object. Keys are hierarchical — invalidating a parent key invalidates all children.

```typescript
// Console: src/hooks/agents/keys.ts

export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (opts?: ListOptions) => [...agentKeys.lists(), opts] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (opts?: ListOptions) => [...sessionKeys.lists(), opts] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
  byAgent: (agentId: string) => [...sessionKeys.all, "byAgent", agentId] as const,
};
```

Invalidation example: when an agent is created, `queryClient.invalidateQueries({ queryKey: agentKeys.all })` invalidates all agent queries (lists and details) so they refetch fresh data.

### Error Handling Strategy

Three tiers, each with a distinct responsibility:

**Tier 1 — Transport Interceptors** (`@stigmer/rpc-client`)

Cross-cutting concerns handled before any application code sees the response:
- Auth token injection (exists)
- gRPC status prefix stripping (exists)
- Future: redirect to login on UNAUTHENTICATED, global error modal on INTERNAL/UNKNOWN

**Tier 2 — Service Factories**

Services throw errors. They never catch, log, or swallow. The caller decides how to handle the error. This is a hard rule — a service factory that catches an error and returns `null` instead of throwing is a bug.

**Tier 3 — Console Components**

Components receive errors from TanStack Query's `{ error }` return and decide the UX:
- Inline error message for query failures
- Toast notification for mutation failures
- Full-page error boundary for critical failures

Notification is a **component responsibility**, not a hook responsibility:

```typescript
// In a page component
const createAgent = useCreateAgent();

function handleCreate(input: CreateAgentInput) {
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
```

### Streaming Hooks — Exception to TanStack Query

Real-time streaming hooks (execution subscription via server-sent events or gRPC streaming) do not fit the request/response model that TanStack Query is designed for. These stay as custom hooks with manual state management.

The existing `useAgentExecution` hook in `@stigmer/agent-execution-ui` is a well-designed example of this pattern. It manages its own `AbortController`, connection state, and error handling because streaming has fundamentally different lifecycle semantics than request/response queries.

Criteria for when to use a custom hook instead of TanStack Query:
- The data source is a stream (server-sent events, gRPC streaming, WebSocket)
- The hook manages a persistent connection with reconnection logic
- The data model is "latest snapshot" rather than "cached response"

### Transport Unification

Two transport mechanisms currently coexist. This decision standardizes on context-based transport.

| Current | Used By | Status |
|---|---|---|
| Module-level singleton (`src/services/transport.ts`) | Console service files (`agent-service.ts`, etc.) | Deprecated — migrate in T07-T08 |
| Context-based (`StigmerTransportProvider`) | Domain libraries (`@stigmer/rpc-client`) | Standard — all new code uses this |

All new service factories use transport from context via `useStigmerTransport()`. The existing module-level services are migrated to context-based service factories in T07 (hook migration) and T08 (service reorganization).

### CQRS Split

Query and command services are separate when the operations are independently useful — different components use queries (list pages, detail pages) and commands (create forms, delete dialogs) independently.

```typescript
// Separate — agents have independent read and write consumers
createAgentQueryService(transport): AgentQueryService
createAgentCommandService(transport): AgentCommandService

// Combined — execution create + subscribe are always used together
createExecutionService(transport): ExecutionService
```

The decision of whether to split or combine is driven by the domain workflow, not by a rigid rule. The guideline is: split by default, combine only when the domain requires it and different consumers would not benefit from independent access.

---

## What We Adopt from Planton

| Pattern | Adoption | Rationale |
|---|---|---|
| CQRS split at service level | Yes | Aligns with proto structure (`QueryController`, `CommandController`). Keeps read and write concerns separate. |
| Bridge pattern for IoC | Yes (already exists) | `StigmerTransportBridge` already bridges auth context into transport provider. No new bridge needed. |
| Transport interceptors | Yes (already exists) | Auth interceptor and error strip interceptor are in place. Future interceptors follow the same pattern. |
| Typed service interfaces | Yes | `ExecutionService` interface in `agent-execution-ui` is the proven model. All services get explicit interfaces. |
| Service factory functions | Yes | `createExecutionService(transport)` is the proven model. All services use this pattern. |

## What We Reject from Planton

### 1. `usePlantonService()` — Bundled Service Context

Planton's `usePlantonService()` returns `{ createRpcClient, setPageLoading, openNotification, envInfo, createNotificationErrorDetails }`. Every domain hook calls it. This means every domain library has a compile-time dependency on the notification system, the page loading mechanism, and the org/env context provider.

**Rejected because**: The architect mandate states "the domain layer has ZERO dependencies on frameworks." `setPageLoading` and `openNotification` are application-level UI concerns. A domain library that calls `openNotification` cannot be embedded in a host application that uses a different notification system — the bridge must be wired, even if the embedder does not want notifications at all.

**Stigmer alternative**: Domain libraries depend only on transport (`useStigmerTransport()`). Loading state is managed by TanStack Query per-query. Notifications are triggered by console components, not by hooks. Org/env context is accessed by console components that pass it to service calls as arguments.

### 2. "Bag of Functions" Return Shape

Planton hooks return `{ query: { get, list, search } }` — an object of async functions. The caller still needs `useState` for loading, error, and data in every component that uses the hook.

**Rejected because**: This pattern pushes the entire state management burden onto the consumer. The hook provides no value beyond transport binding — it is a thin wrapper over the gRPC client that does not manage any React state. Every component that calls `query.get(id)` must independently implement loading spinners, error displays, and staleness handling.

**Stigmer alternative**: TanStack Query hooks return managed state (`{ data, isLoading, error, refetch }`). The state management complexity is handled once in the hook definition, not in every consumer.

### 3. `useState` + `useMemo` + `useEffect` Boilerplate

Every Planton hook follows the same ~80-100 line pattern: create client via `useRpcClient`, set `query`/`command` state when client is ready, build memoized API object with loading/notification wiring in each method.

**Rejected because**: This is maintenance overhead with no additional value. The pattern is identical across hooks — it should be abstracted, not copy-pasted. TanStack Query abstracts this pattern into 5-10 lines per hook.

### 4. Nullable `query`/`command` Objects

Planton's `useRpcClient()` returns `Client<T> | null` because the client is created lazily via `useMemo` against a potentially-null transport. Hooks then set their `query`/`command` state via `useEffect` when the client becomes available. This means `query` and `command` are `null` during the first render cycle.

**Rejected because**: This forces null checks at every call site (`query?.get(id)`). It is an artifact of Planton's transport initialization pattern, not a fundamental requirement. Stigmer's `useServiceClient()` already returns a non-null `Client<T>` because `useStigmerTransport()` throws if called outside the provider — the transport is guaranteed available. Service hooks are never null.

### 5. `defaultState` in Hook Return

Planton hooks optionally return `defaultState` — a pre-populated resource object with `metadata.org` and `metadata.env` from context, used as form defaults for create flows.

**Rejected because**: Form defaults are a console UI concern. The page component reads org/env from `useOrg()` and passes defaults to the form. The service hook has no business knowing about form pre-population.

---

## Impact on T09 (StigmerServiceBridge)

The T01 plan proposed creating a `StigmerServiceBridge` modeled on Planton's `PlantonServiceBridge`, which bundles `createRpcClient`, `setPageLoading`, `openNotification`, `envInfo`, and `createNotificationErrorDetails` into a single context.

With the decisions in this document, most of what `StigmerServiceBridge` would provide is already handled elsewhere:

| Capability | Handled By |
|---|---|
| RPC client creation | `StigmerTransportProvider` + `useServiceClient()` (exists) |
| Loading states | TanStack Query per-query/mutation (new) |
| Notifications | Console components via mutation callbacks (new) |
| Org/env context | `OrgProvider` + `useOrg()` (exists) |
| Error detail formatting | Console-level utility function (future T10) |

`StigmerTransportBridge` already exists and bridges the auth session into the transport provider. No additional bridge is needed for the scope covered by T06. T09 should be re-scoped to focus on error handling interceptors and possibly a lightweight notification utility — not a monolithic service bridge.

This is a simplification of the T01 plan, not a violation of it. The architecture achieves the same goals (consistent error handling, loading indicators, notifications) through composition rather than a single bundled context.

---

## Migration Mapping

| Current Hook | Current Location | Category | Migration Target |
|---|---|---|---|
| `useAgentDetail(id)` | `src/hooks/` | Query | `useAgent(id)` via `useQuery` |
| `useSkillDetail(id)` | `src/hooks/` | Query | `useSkill(id)` via `useQuery` |
| `useMcpServerDetail(id)` | `src/hooks/` | Query | `useMcpServer(id)` via `useQuery` |
| `useSessions(opts)` | `src/hooks/` | Query (paginated) | `useSessionList()` via `useInfiniteQuery` |
| `useAgentSessions(agentId)` | `src/hooks/` | Query (paginated) | `useAgentSessionList(agentId)` via `useInfiniteQuery` |
| `useAgentSearch(query)` | `src/hooks/` | Query (search) | `useAgentSearch(query, org)` via `useQuery` + debounce |
| `useSessionDetail(id)` | `src/hooks/` | Query (composite) | Split: `useSession(id)` + `useSessionExecutions(sessionId)` |
| `useDraftAgent(slug)` | `src/hooks/` | Query | `useDraftAgent(slug)` via `useQuery` |
| `useResourceCatalog` | `src/hooks/` | Query | Deleted (catalog removed in T05) |
| `useAgentExecution` | `@stigmer/agent-execution-ui` | Stream | Stays custom (streaming, not request/response) |
| `useApproval` | `@stigmer/agent-execution-ui` | Command | Stays custom or migrate to `useMutation` |

Service files in `src/services/` (`agent-service.ts`, `session-service.ts`, `skill-service.ts`, `mcp-server-service.ts`, `search-service.ts`, `org-service.ts`) are migrated to Layer 1 service factories + Layer 2 service hooks during T07-T08.

---

## Alternatives Rejected

### A. Copy Planton's Pattern Directly

Adopt `usePlantonService()` and the "bag of functions" return shape exactly as Planton implements it.

**Rejected because**: Couples domain libraries to UI concerns (notifications, page loading). Does not manage React state — pushes the burden to every consumer component. Every hook is 80-100 lines of near-identical boilerplate. Nullable query/command objects force defensive checks at every call site. See detailed analysis above.

### B. TanStack Query in Domain Libraries

Make domain libraries depend on TanStack Query and export ready-to-use `useQuery`/`useMutation` hooks.

**Rejected because**: Domain libraries are embeddable. The `_roles/004_web_ux_ui.md` mandate states: "Components must be designed as self-contained, embeddable units first." A host application that uses SWR or Apollo should not be forced to also install TanStack Query. The service factory (Layer 1) is the integration point — it works with any data fetching strategy.

### C. No TanStack Query — Manual State Everywhere

Keep the current `useState` + `useCallback` + `useEffect` pattern and just standardize the return shapes.

**Rejected because**: This means every hook reimplements caching, deduplication, loading states, error handling, and refetching. The current hooks already demonstrate the problems — each is 40-80 lines of boilerplate, with no caching, no stale-while-revalidate, and no background refetching. For an operational dashboard (Sessions, Dashboard status cards), automatic refetching and cache invalidation are critical. Manual state management cannot provide these without essentially rebuilding TanStack Query.

### D. SWR Instead of TanStack Query

Use Vercel's SWR library instead of TanStack Query.

**Rejected because**: TanStack Query has stronger TypeScript support, explicit mutation handling (`useMutation` with cache invalidation), `useInfiniteQuery` for pagination, and broader industry adoption. SWR is simpler but does not have first-class mutation support — it treats writes as side effects that happen to trigger revalidation.

### E. Custom Caching Layer

Build a custom caching and state management layer tailored to Stigmer's needs.

**Rejected because**: This would be reinventing TanStack Query. The engineering effort is not justified when a battle-tested, well-maintained library exists. Custom caching layers are a common source of subtle bugs (stale data, memory leaks, race conditions) that TanStack Query has already solved.

---

## Implementation

This decision drives the following tasks:

- **T06 (this task)**: Design decision document (this file) + coding guideline
- **T07**: Migrate existing hooks to three-layer pattern, introduce TanStack Query
- **T08**: Reorganize service files into domain-aligned service factories
- **T09**: Re-scoped — error handling interceptors + notification utility (not a monolithic bridge)
- **T10**: Transport-level error interceptors (auth redirect, server error modal)

---

## Resolved Questions

### 1. `useApproval` Stays in the Domain Library as a Custom Hook

`useApproval` remains in `@stigmer/agent-execution-ui` without TanStack Query.

**Architect rationale**: Approval is part of the execution aggregate. The `ApprovalControls` component is an embeddable unit — platform builders embedding the execution viewer expect the approval UI to work self-contained, without wiring external mutation hooks. Moving `useApproval` to the console would either break the component's self-contained nature (forcing callers to pass `onApprove` callback props) or make the domain library depend on TanStack Query (violating the "console level only" rule).

**Web UX/UI rationale**: The mandate states "every component built for the Stigmer Console should be evaluated as a potential embeddable." HITL approval is core to the execution viewer. It must work identically whether rendered in the Console or embedded in a third-party dashboard. The approval hook's current shape — `{ submit, isSubmitting, error, clearError }` — is already correct: it manages local mutation state without needing caching or deduplication.

**Rule for future domain-library hooks**: Hooks in domain libraries that serve embeddable components should use manual state management (the `useApproval` pattern). TanStack Query is reserved for console-level hooks that compose domain services for page-level data fetching. The dividing line is: if the hook's consumer is an embeddable component, it stays manual; if the consumer is a console page, it uses TanStack Query.

### 2. Org-Scoped Queries: Explicit at Service Level, Contextual at Console Level

Two-layer approach:

- **Layer 1 (service factory)**: Always takes `org` as an explicit parameter. This keeps service factories testable without React context and usable by platform builders who may not have Stigmer's `OrgProvider`.

- **Layer 3 (console query hook)**: Reads org from `useOrg()` context and passes it to the service. The console user never thinks about which org is active — it's automatic.

```typescript
// Layer 1 — explicit org, no React context dependency
interface AgentQueryService {
  search(query: string, org: string): Promise<SearchResult>;
}

// Layer 3 — console hook reads org from context
function useAgentSearch(query: string) {
  const { activeOrgSlug } = useOrg();
  const service = useAgentQueryService();
  return useQuery({
    queryKey: agentKeys.search(query, activeOrgSlug),
    queryFn: () => service.search(query, activeOrgSlug),
    enabled: !!query && !!activeOrgSlug,
  });
}
```

**Architect rationale**: Domain purity. Service factories have zero React dependencies. They take all inputs as function arguments, making them testable in Node.js without any provider tree.

**UX designer rationale**: Recognition over recall (Nielsen #6). Console users should not manually select or pass their org for every query — the active org context handles this automatically. But this is a UI convenience, not a service concern. Including `activeOrgSlug` in the query key also means switching orgs automatically triggers a refetch — correct behavior with zero manual cache management.
