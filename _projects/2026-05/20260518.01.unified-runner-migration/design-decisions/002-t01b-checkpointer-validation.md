# Design Decision 002: T01b — LangGraph JS Checkpointer Validation

**Date**: 2026-05-18
**Status**: PROPOSED
**Context**: T01 Research Spike (Phase 0 Hard Gate)
**Decision**: Validate LangGraph JS checkpointer capabilities for HITL interrupt/resume

## Background

The Python agent-runner uses LangGraph checkpointers for two critical
purposes:

1. **HITL interrupt/resume** — when a tool call requires human approval,
   `interrupt()` saves graph state, the activity returns to the workflow,
   and on reinvocation `Command(resume=...)` restores state and continues.

2. **Conversational context** — multi-turn conversations within a session
   use checkpointed thread state to maintain context across executions.

The Python stack supports four checkpointer backends:
- `MemorySaver` (in-memory, ephemeral)
- `AsyncSqliteSaver` (file-based, single-instance)
- `MongoDBSaver` (database, multi-instance, production)
- `HttpCheckpointSaver` (custom, routes through Stigmer proxy to MongoDB)

## Findings

### 1. MemorySaver — Confirmed Available

`@langchain/langgraph` exports `MemorySaver` directly. Usage is identical
to Python:

```ts
import { MemorySaver } from "@langchain/langgraph";
const checkpointer = new MemorySaver();
```

Passed to `createDeepAgent({ checkpointer })`. Suitable for development
and testing. Ephemeral — data lost on process restart.

**Status**: VALIDATED (from Deep Research + npm docs)

### 2. MongoDBSaver — Confirmed Available

Available via `@langchain/langgraph-checkpoint-mongodb`:

```ts
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
const checkpointer = MongoDBSaver.fromConnString(uri, { dbName });
```

The Python `MongoDBSaver` uses `pymongo` (sync driver with `run_in_executor`
for async). The JS version is a native npm package. Key differences to verify
in the PoC:

- **TTL support**: Python version accepts `ttl` parameter for automatic
  checkpoint expiry. Verify JS equivalent.
- **Schema compatibility**: If Python and JS runners share the same MongoDB
  database (during migration), verify that the checkpoint document schema
  is compatible. If not, the unified runner needs its own collection.
- **Connection lifecycle**: Python uses a `MongoClient` passed to the
  constructor, managed by our async context manager. JS likely manages
  its own connection. Verify cleanup on worker shutdown.

**Status**: VALIDATED (from Deep Research + npm registry)

### 3. interrupt() / Command({ resume }) — Confirmed Available

LangGraph JS supports the full HITL interrupt/resume flow:

```ts
import { interrupt } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";

// In a graph node or tool:
const approval = interrupt({ toolCallId, args });

// Resuming:
const result = await graph.invoke(
  new Command({ resume: { [interruptId]: "approve" } }),
  { configurable: { thread_id } }
);
```

**Critical semantics from Deep Research (verified from LangGraph JS docs)**:

1. **Node restarts from the beginning when resumed.** Code before
   `interrupt()` runs again. Side effects before the interrupt must be
   idempotent.

2. **Multiple simultaneous interrupts** are supported with interrupt IDs.
   This maps to our Python flow where multiple tool calls can be
   pending approval simultaneously.

3. **Interrupts inside tools** are supported. DeepAgents JS `interruptOn`
   config integrates with this mechanism.

4. **Pending writes recovery**: LangGraph JS stores node/task-level writes
   into `checkpoint_writes` for recovery after partial super-step failure.

**Parity with Python behavior**:

The Python agent-runner's HITL flow (`graphton/hitl.py`) works as follows:
1. `agent_graph.aget_state` reads `interrupts` from checkpoint
2. `Command(resume=resume_dict)` maps interrupt ID to approval action
3. DB-driven resume: if no Temporal-passed decisions, pulls from execution
   records via `extract_approval_decisions_from_execution`

The JS equivalent should follow the same pattern. The cursor-runner already
implements a simpler version: detect `WAITING_FOR_APPROVAL` phase, return
to workflow, workflow signals, reinvoke activity, activity reads approvals
from DB and injects continuation prompt.

For the unified runner's `ExecuteDeepAgent` activity, the flow would be:
1. Stream agent execution
2. On interrupt (tool needs approval) → build pending approvals in status
3. Return `EXECUTION_WAITING_FOR_APPROVAL` to workflow
4. Workflow waits for `approvalGateResolved` signal
5. Reinvoke `ExecuteDeepAgent` activity
6. Activity reads approved/rejected decisions from DB
7. Resume graph with `new Command({ resume: decisions })`
8. Continue streaming

**Status**: VALIDATED (mechanism exists; exact semantics need PoC testing)

### 4. Custom HTTP Checkpointer — Feasible

LangGraph JS checkpointers implement `BaseCheckpointSaver` with:
- `put(config, checkpoint, metadata, newVersions)` → `RunnableConfig`
- `putWrites(config, writes, taskId)` → `void`
- `getTuple(config)` → `CheckpointTuple | undefined`
- `list(config, options?)` → `AsyncGenerator<CheckpointTuple>`

Our Python `HttpCheckpointSaver` (408 lines) routes through the Stigmer
proxy (`/v1/proxy/checkpoints`) using `httpx`. It serializes via
`JsonPlusSerializer.dumps_typed()` and encodes binary as MongoDB Extended
JSON v2 `$binary` objects for compatibility with the Java proxy.

**Porting assessment**:

The JS equivalent would:
- Implement `BaseCheckpointSaver` from `@langchain/langgraph`
- Use `fetch` or `undici` for HTTP transport
- Use `JsonPlusSerializer` from `@langchain/langgraph/serde` (if available
  in JS) or a compatible serialization approach
- Encode/decode the same `$binary` format for Java proxy compatibility

**Key risk**: `JsonPlusSerializer` may not exist in JS, or may produce
a different wire format than the Python version. If the unified runner
replaces the Python runner entirely, wire compatibility with the existing
Java proxy is only needed during a transition period — after cutover, the
JS saver can define its own serialization as long as the proxy accepts it.

**Recommendation**: Defer HTTP saver to Phase 2. Use `MongoDBSaver` for
the initial unified runner, which is simpler and proven. The HTTP saver
is only needed when the runner cannot have direct MongoDB access (the
proxy-mediated path). Since the sandbox image bundles the runner, and
the runner connects to MongoDB via the same network as the proxy, direct
MongoDB access is available.

**Status**: FEASIBLE (defer to Phase 2)

### 5. SQLite / Postgres / Redis Savers — Available but Not Required

The following are available via npm but not immediately needed:
- `@langchain/langgraph-checkpoint-sqlite` — for OSS local persistence
- `@langchain/langgraph-checkpoint-postgres` — alternative to MongoDB
- `@langchain/langgraph-checkpoint-redis` — for Redis-backed persistence

**Note on SQLite**: Deep Research flagged a SQL injection vulnerability
in an earlier version of the SQLite checkpointer. Pin to patched versions
and run SCA if SQLite is used.

**Status**: AVAILABLE (use if/when needed for OSS edition)

### 6. Compatibility with createDeepAgent

The Deep Research report confirms that `createDeepAgent` from the
`deepagents` npm package accepts a `checkpointer` parameter:

```ts
createDeepAgent({
  model,
  checkpointer: new MemorySaver(),
  interruptOn: [{ toolName: "dangerous_tool", decisions: ["approve", "deny"] }],
  // ...
});
```

The returned graph is a compiled LangGraph graph, so all LangGraph
checkpointer features (persistence, interrupt, resume, state history)
are available through the returned object.

**Status**: VALIDATED

## Checkpointer Migration Strategy

| Phase | Checkpointer | Use Case |
|-------|-------------|----------|
| T01c PoC | `MemorySaver` | Validate interrupt/resume mechanics |
| Phase 1 (scaffold) | `MemorySaver` | Development and unit tests |
| Phase 2 (core infra) | `MongoDBSaver` | Integration tests and staging |
| Phase 3 (ExecuteDeepAgent) | `MongoDBSaver` | Production deep agent execution |
| Phase 6 (deployment) | `MongoDBSaver` + optional `HttpCheckpointSaver` | Full production |

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| interrupt() node re-execution breaks idempotency | HIGH | Design activity to be idempotent before interrupt point. PoC must test this explicitly. |
| MongoDB checkpoint schema incompatible between Python and JS | MEDIUM | Use separate collection for JS checkpoints during transition. After full cutover, old checkpoints are irrelevant. |
| JsonPlusSerializer wire format differs in JS | MEDIUM | Only relevant for HTTP saver. Defer to Phase 2. Direct MongoDB access avoids this entirely. |
| Multiple simultaneous interrupts have edge cases | MEDIUM | Build HITL parity test suite (as recommended by Deep Research). |
| MongoDBSaver JS lacks TTL support | LOW | Implement TTL via MongoDB TTL index on the collection directly, not the saver. |

## Recommendation

LangGraph JS checkpointers are **validated for the migration**. The core
mechanism (MemorySaver, MongoDBSaver, interrupt/resume) is available and
well-documented. The HTTP saver is feasible but should be deferred.

Proceed to T01c (PoC) to validate exact interrupt/resume semantics with
`MemorySaver` in a live `createDeepAgent` execution.
