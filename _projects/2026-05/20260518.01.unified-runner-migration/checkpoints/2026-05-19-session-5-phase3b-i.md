# Session Notes: 2026-05-19 — Phase 3b-i (Session 5)

## Accomplishments

- Completed Phase 3b-i: StatusBuilder + GrpcRetryExecutor + Streaming Loop
- Replaced `invoke()` with `streamEvents()` v2 progressive streaming
- Built 5 new modules + modified `index.ts`
- 79 new tests (169 total), typecheck clean, build clean
- Committed: `c664b87a5` on `feat/unified-runner-migration`

## New Files

| File | Lines | Tests | Purpose |
|------|-------|-------|---------|
| `execution-state.ts` | ~90 | 9 | Mutable state: proto + O(1) indexes |
| `streaming-scheduler.ts` | ~160 | 20 | Hybrid time+event scheduler (500ms/50/5s) |
| `grpc-retry.ts` (shared) | ~110 | 15 | Exponential backoff retry with gRPC error classification |
| `status-builder.ts` | ~270 | 26 | LangGraph event-to-proto mapper |
| `streaming.ts` | ~230 | 9 | `streamEvents()` consumption loop |

## Decisions Made

- **Persistence cadence**: Hybrid time+event (ported from Python's battle-tested scheduler), not Cursor's simpler every-20-events
- **STOP handling**: Break loop immediately in Phase 3b-i; GracefulStopMiddleware wired in 3b-ii
- **gRPC retry**: Separate from `persistStatus` (which is shared with Cursor); deep-agent specific
- **Sub-agent routing**: Deferred to Phase 3c — ExecutionState scoped to main-agent only
- **Tool input streaming**: Deferred — requires middleware infrastructure from 3b-ii
- **JsonObject cast**: `ToolCall.args` requires `JsonObject` (not `Record<string, unknown>`) — fixed with explicit cast

## Key Code Changes

- `index.ts`: Removed `executeAgent()`, `buildFinalStatus()`, `extractContent()`, `AgentResult`, `ExtractedMessage` (~80 lines). Added `streamExecution()` call with `StreamDependencies` construction (~20 lines).
- `shared/grpc-retry.ts`: New shared module — `persistWithRetry()` with ConnectError classification.

## Learnings

- `@bufbuild/protobuf` generated types use `JsonObject` for `google.protobuf.Struct` fields, not plain `Record<string, unknown>`. Need explicit cast.
- `ToolCallSchema` does exist in the generated stubs (some exploration agents reported it as missing — it's at `message_pb.ts` line 275).
- All proto schemas confirmed: `AgentMessageSchema`, `ToolCallSchema`, `RunnerUsageSummarySchema` available from `@stigmer/protos`.

## Open Questions

- `deepagents` JS `streamEvents()` v2 event format needs live validation against actual LangGraph JS runtime — unit tests use mock events shaped from Python reference. If shapes differ, handlers need adjustment.
- `GraphRecursionError` detection is by constructor name string match — may need refinement when tested against real `deepagents` JS runtime.

## Next Session Plan

1. **Phase 3b-ii: Middleware Stack** — Port 8 graphton middleware modules:
   - `src/middleware/loop-detection.ts`
   - `src/middleware/cost-cap.ts`
   - `src/middleware/execution-budget.ts`
   - `src/middleware/tool-truncation.ts`
   - `src/middleware/graceful-stop.ts`
   - `src/middleware/error-hints.ts`
   - `src/middleware/think-tool.ts`
   - `src/middleware/otel-spans.ts`
   - `src/middleware/index.ts` (factory)
2. Wire `AbortController` shared between streaming loop and GracefulStopMiddleware
3. Wire middleware stack into `createDeepAgent()` call in `setup.ts`
