/**
 * A turn's trace context as it crosses to the agent host: one W3C
 * `traceparent` string.
 *
 * The run's `invoke_agent` span lives in the runner (`harness/run-span.ts`)
 * and the engines' `chat` and `execute_tool` spans in the agent host, a
 * process of its own. The runner sends the active context's `traceparent`
 * with each turn (`agent-host/protocol.ts` `runTurn`), and the host runs the
 * turn inside it, so the engines' spans nest under the run's span in one
 * trace instead of starting traces of their own.
 *
 * W3C Trace Context's own propagator is used directly, not the global one,
 * so the crossing does not depend on which propagators either process
 * registered. With tracing off there is no recording span and nothing to
 * carry: the field is `null` and the host runs the turn as before.
 */

/** The active context's `traceparent`, or `null` when no span is recording. */
export async function activeTraceparent(): Promise<string | null> {
  const api = await import("@opentelemetry/api");
  if (!api.trace.getSpan(api.context.active())?.isRecording()) return null;
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
  const carrier: Record<string, string> = {};
  new W3CTraceContextPropagator().inject(api.context.active(), carrier, api.defaultTextMapSetter);
  return carrier.traceparent ?? null;
}

/** Run `fn` with the remote span `traceparent` names as its parent; `fn` as it is when there is none. */
export async function withTraceparent<T>(traceparent: string | null, fn: () => Promise<T>): Promise<T> {
  if (traceparent === null) return fn();
  const api = await import("@opentelemetry/api");
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
  const parent = new W3CTraceContextPropagator().extract(api.context.active(), { traceparent }, api.defaultTextMapGetter);
  return api.context.with(parent, fn);
}
