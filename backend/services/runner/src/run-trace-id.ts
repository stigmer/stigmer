/**
 * One trace per run: a root span started inside a run's execution context
 * takes a trace id derived from the run's id.
 *
 * A run can take several turns, each its own Temporal activity: it waits
 * for an approval and is invoked again (`shared/activity-input.ts`
 * `turn_seq`). Each turn's `invoke_agent` span is a root
 * (`harness/run-span.ts`); with random ids, a run that waited for an
 * approval would read as two unrelated traces in a tracing tool. Deriving
 * the id makes every turn of a run a root span in the same trace, so the
 * tool lists the run once, named and summarized by its latest turn.
 *
 * The id is the first 16 bytes of SHA-256 over the run id: uniform like a
 * random id, never all zero in practice, and predictable from the run id,
 * which is no secret from anyone who can see the trace; nothing authorizes
 * by a trace id. W3C Trace Context prefers random ids; the runner already
 * derives fixed ids from a run the same way (the Cursor change-set id,
 * `executionId:turnSeq`). Outside a run's context, and for every span id,
 * the ids stay random.
 *
 * The generator is installed on the providers the runner itself owns
 * (`otel.ts`). Where an embedder owns the tracer provider, the generator is
 * the embedder's, and each turn is a trace of its own, grouped by the
 * conversation's id.
 */

import { createHash } from "node:crypto";

import { RandomIdGenerator, type IdGenerator } from "@opentelemetry/sdk-trace-base";

import { getExecutionContext } from "./shared/execution-context.js";

/** The trace id of a run's trace: 32 lowercase hex characters. */
export function traceIdOfRun(runId: string): string {
  return createHash("sha256").update(runId, "utf8").digest("hex").slice(0, 32);
}

/** Root spans inside a run's execution context get the run's trace id; every other id is random. */
export class RunTraceIdGenerator implements IdGenerator {
  private readonly random = new RandomIdGenerator();

  generateTraceId(): string {
    const runId = getExecutionContext().getStore()?.executionId;
    return runId ? traceIdOfRun(runId) : this.random.generateTraceId();
  }

  generateSpanId(): string {
    return this.random.generateSpanId();
  }
}
