# TSDoc Standards for @stigmer/react

These standards govern all public exports in the React SDK (`sdk/react/src/`).
They are the reference for TSDoc backfill (T05/T07) and for future SDK
contributions. The auto-generated reference pages (T03) render whatever
TypeDoc extracts, so the quality of the generated docs is directly tied
to the quality of these comments.

## Writing Register

React SDK TSDoc uses the **Reference / SDK** register defined in
`docs/vocabulary.md`:

- **Precise technical language.** Use API field names, proto message
  types, and Stigmer domain terms (Agent, Session, Execution, Skill,
  MCP Server) exactly as they appear in the domain model.
- **Assume platform familiarity.** The reader has gone through the
  Getting Started guide and understands what an Agent, Session, and
  Execution are. Do not re-explain core concepts.
- **No jargon glossing.** This is reference documentation, not a
  tutorial. Write "`agentExecution.subscribe()`" not
  "the method that subscribes to execution updates."
- **Active voice, present tense.** "Fetches a single Session" not
  "A Session will be fetched."
- **Lead with what, not how.** Start summaries with what the export
  does for the consumer, not how it works internally.

## Required Documentation by Export Type

### Hooks (`use*` functions)

Every hook must have:

1. **Summary** — First sentence states the hook's purpose using the
   pattern: `{Data|Behavior|Composition} hook that {verb phrase}.`

   - *Data hook*: wraps a single RPC call with loading/error state.
   - *Behavior hook*: manages a lifecycle (stream subscription,
     multi-step flow, stateful interaction).
   - *Composition hook*: composes multiple hooks into a higher-level
     return value.

2. **Behavioral details** — After the summary, describe:
   - What happens when the primary parameter is `null` (skip behavior).
   - What happens when parameters change (abort/refetch).
   - Any error handling semantics (not-found → null vs. error).

3. **`@param`** — One tag per parameter. Keep to one sentence.
   Self-documenting names like `sessionId` still need a `@param` tag
   because the generated reference page renders it as a table row.

4. **`@example`** — At least one realistic TSX snippet showing the hook
   in a component. Show the typical destructuring pattern and the
   loading/error/success branches.

5. **`{@link}`** — Cross-reference related hooks and components where
   it helps the reader find the next thing. Use `{@link HookName}` for
   SDK-internal links.

`@returns` is optional. The return type name appears in the generated
signature and the Return Interface documents each field.

#### Gold standard: `useAgent`

```ts
/**
 * Data hook that fetches a single Agent blueprint by organization and slug.
 *
 * Wraps `stigmer.agent.getByReference()` with loading, error, and
 * not-found state management. When the `org` or `slug` parameters
 * change, the previous in-flight request is discarded and a fresh
 * fetch begins.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op). This is useful when the slug is not yet available — for
 * example, while a parent component is still resolving route params.
 *
 * **Not-found handling:** If the API returns a 404 (NOT_FOUND), the
 * hook sets `agent` to `null` without raising an error. Consumers
 * distinguish "not found" from "loading" by checking all three fields:
 * `agent === null && !isLoading && !error` means the resource does
 * not exist.
 *
 * @example
 * ```tsx
 * function AgentDetail({ org, slug }: { org: string; slug: string }) {
 *   const { agent, isLoading, error } = useAgent(org, slug);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!agent) return <NotFound />;
 *
 *   return <h1>{agent.metadata?.name}</h1>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until slug is known
 * const { agent } = useAgent(org, slug ?? null);
 * ```
 */
```

### Components (non-`use*` functions returning JSX)

Every component must have:

1. **Summary** — What the component renders and where it fits in the UI
   hierarchy.

2. **Behavioral notes** — Mention whether the component fetches data,
   manages state, or is purely presentational. If it composes other
   SDK components, name them.

3. **`@example`** — A TSX snippet showing the component in a parent.
   Show the minimum props needed for a working render.

4. **`{@link}`** — Reference the associated `*Props` interface.

#### Gold standard: `MessageEntry`

```ts
/**
 * Renders a single message in the conversation thread.
 *
 * - `MESSAGE_HUMAN` — plain text with muted background
 * - `MESSAGE_AI` — markdown-rendered via `react-markdown` + `remark-gfm`,
 *   with a blinking cursor while streaming
 * - `MESSAGE_SYSTEM` — small muted text
 * - `MESSAGE_TOOL` / `UNSPECIFIED` — renders nothing (tool results are
 *   consumed by {@link ToolCallGroup} in SP4)
 *
 * Purely presentational — no data fetching, no state.
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <MessageEntry message={agentMessage} />
 * ```
 */
```

### Props Interfaces (`*Props`)

Every props interface must have:

1. **Top-level summary** — One line following the pattern:
   `Props for {@link ComponentName}.`

   Add a second sentence only if the props have domain-level meaning
   beyond "the component's configuration" (e.g., when the props
   represent a slice of a larger data model).

2. **Per-field documentation** — Every field must have a JSDoc comment.
   - State what the field controls, not its type (the type is visible).
   - For optional fields, describe the default behavior when omitted.
   - For callbacks, describe when the callback fires, what the
     arguments represent, and whether the return value matters.

#### Template

```ts
/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /** Completed executions in chronological order. */
  readonly executions: readonly AgentExecution[];
  /**
   * The currently streaming execution. Appended after `executions` to
   * form a continuous thread. Pass `null` or `undefined` when no
   * execution is actively streaming.
   */
  readonly activeStreamExecution?: AgentExecution | null;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}
```

#### What to avoid

```ts
// BAD: No interface summary, no field docs.
export interface MessageEntryProps {
  readonly message: AgentMessage;
  readonly className?: string;
}
```

### Return Interfaces (`Use*Return`)

Every return interface must have:

1. **Top-level summary** — One line following the pattern:
   `Return value of {@link useHookName}.`

2. **Per-field documentation** — Every field must have a JSDoc comment.
   Most return interfaces share a standard shape. Use these templates:

| Field pattern | Template comment |
|---------------|-----------------|
| `data: T \| null` | `The fetched {resource}, or \`null\` while loading or on error.` |
| `isLoading: boolean` | `\`true\` while the initial fetch or a refetch is in flight.` |
| `error: Error \| null` | `Error from the last failed request, or \`null\` when healthy.` |
| `refetch: () => void` | `Discard cached data and re-fetch from the server.` |
| `isStreaming: boolean` | `\`true\` while receiving non-terminal updates from the server stream.` |
| `isConnecting: boolean` | `\`true\` after subscription starts but before the first snapshot arrives.` |
| `reconnect: () => void` | `Reset error state and re-establish the stream subscription.` |

Adapt the resource name and behavioral details, but keep the structure
consistent across all return interfaces.

#### Template

```ts
/** Return value of {@link useSession}. */
export interface UseSessionReturn {
  /** The fetched Session, or `null` while loading or on error. */
  readonly session: Session | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the session from the server. */
  readonly refetch: () => void;
}
```

#### What to avoid

```ts
// BAD: No interface summary, only 1 of 4 fields documented.
export interface UseSessionReturn {
  readonly session: Session | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Re-fetch the session from the server. */
  readonly refetch: () => void;
}
```

### Other Interfaces (Input types, Options, Data shapes)

These require case-by-case authoring. Each must have:

1. **Top-level summary** — What the type represents and where it is
   used. Name the hook or component that consumes it.

2. **Per-field documentation** — For domain-meaningful fields. Fields
   like `org: string` or `slug: string` may be self-documenting in
   context, but still benefit from a brief comment (e.g.,
   `Organization slug for the API call.`).

#### Template

```ts
/**
 * Options for {@link UseSessionConversationReturn.sendFollowUp}.
 *
 * Session-level fields (`workspaceEntries`, `mcpServerUsages`,
 * `skillRefs`) trigger a `session.update()` before the execution is
 * created. Only provided fields are overwritten; omitted fields
 * preserve the session's existing values.
 */
export interface SendFollowUpOptions {
  readonly modelName?: string;
  /**
   * Override the session's agent instance for this and all future
   * executions. When provided, the session is updated before the
   * execution is created.
   */
  readonly agentInstanceId?: string;
  // ...
}
```

### Type Aliases

Type aliases must have a top-level summary. If the alias wraps a union,
document each variant's meaning.

```ts
/**
 * Lifecycle phase of a running execution, derived from the proto
 * `ExecutionPhase` enum. Excludes internal-only phases.
 */
export type ExecutionDisplayPhase =
  | "pending"
  | "running"
  | "awaiting-approval"
  | "completed"
  | "failed";
```

### Variables

Exported constants must have a summary stating what the value is and
where it is used. If the value is a React context, state what the
context provides.

```ts
/** Default model ID used when no model preference is set. */
export const DEFAULT_MODEL_ID = "claude-sonnet-4-20250514";
```

## Patterns for Tricky Cases

### `{@link}` to external types

Types from `@stigmer/protos` and `@stigmer/sdk` are external. TypeDoc
cannot resolve `{@link Session}` to a URL automatically with
`excludeExternals: true`.

**Current approach:** Use `{@link Session}` in prose anyway. TypeDoc
emits a warning, but the text renders as a code reference in the
generated docs. In T03, the MDX generator will map known proto types
to their existing resource page URLs under `/docs/sdk/resources/`.

**Do not** inline-document proto types. Write
"the full proto {@link Session} resource" and let the generator handle
the link.

### Callback props

Document three things:

1. **When** the callback fires.
2. **What** the arguments mean.
3. **Whether** the return value matters (usually it does not).

```ts
/**
 * Called when an MCP server reference is clicked.
 * Provides `org` and `slug` of the referenced MCP server so the
 * consumer can wire navigation. When the reference has no explicit
 * org, the agent's own org is used as fallback.
 */
readonly onMcpServerClick?: (org: string, slug: string) => void;
```

### Union type fields

When a field accepts a union, document what each variant means. The
TypeScript type shows `string | null`, but the reader needs to know
*why* `null` is a valid value.

```ts
/** Session to display. Pass `null` to skip loading (stable no-op). */
readonly sessionId: string | null;
```

### `__namedParameters` (destructured props)

React components that destructure props show `__namedParameters` as
the parameter name in TypeDoc's JSON. The MDX generator (T03) follows
the type reference to find the props interface. No special TSDoc
handling is needed — just make sure the props interface itself is
documented.

### Standard data hook shape

Many hooks follow a standard pattern:
`{ resource, isLoading, error, refetch }`. Document all four fields
even though they seem obvious. The generated reference page renders
them as a table; empty cells look broken.

Use the field templates from the Return Interfaces section above. Adapt
the resource name: "The fetched Agent" / "The fetched Session" /
"The list of MCP servers".

## Measuring Progress

Run the coverage script after each backfill session:

```bash
cd sdk/react
npm run tsdoc:coverage                   # summary
npm run tsdoc:coverage -- --undocumented  # what's still missing
npm run tsdoc:coverage -- --fields        # field-level gaps
```

### Coverage Targets

| Category | Current | Target |
|----------|--------:|-------:|
| Hooks | 100.0% | 100% (maintain) |
| Components | 97.8% | 100% |
| Props Interfaces | 1.8% | 100% |
| Return Interfaces | 0.0% | 100% |
| Other Interfaces | 47.6% | 100% |
| Type Aliases | 75.9% | 100% |
| Variables | 57.1% | 100% |
| **Overall** | **57.6%** | **100%** |

The Props Interfaces and Return Interfaces columns move fastest because
they are mechanical (one-line formulaic summaries). Other Interfaces
require genuine authoring and will take more time.
