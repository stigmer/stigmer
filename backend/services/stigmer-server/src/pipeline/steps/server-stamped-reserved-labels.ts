/**
 * ServerStampedReservedLabels — the per-request record of reserved
 * `stigmer.ai/*` label keys that pipeline steps vouched for server-side
 * (the Java ServerStampedReservedLabels port, cloud#386; parity entry
 * 20260830.05).
 *
 * Some lanes legitimately carry reserved labels the client "sent": the
 * workflow runner's CallAgent activity stamps the lineage pair
 * (`stigmer.ai/workflow-execution-id`, `stigmer.ai/workflow-task`) on
 * every child execution it creates. To GuardReservedLabels, which diffs
 * the built state against the stored one, those stamps are
 * indistinguishable from client mutations. A step that has made the
 * trust decision for specific keys records EXACTLY those keys here, and
 * the guard exempts exactly them — everything else in the namespace
 * stays operator-only, so a client smuggling a different reserved key
 * into the same request is still rejected.
 *
 * The record lives in the request context's metadata map: only server
 * code can reach it, and it never survives the request (the same
 * request-scoped posture as Java's gRPC Context key).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { RequestContext } from "../request-context.js";

/** The context-metadata key carrying the vouched key set. */
const STAMPED_KEYS_CONTEXT_KEY = "serverStampedReservedLabels";

/**
 * Records reserved label keys the calling step vouched for on this
 * request. Call immediately next to the decision that vouches them, so
 * the record and the decision cannot drift apart.
 */
export function recordServerStampedReservedLabels<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
  ...keys: ReadonlyArray<string>
): void {
  const existing = ctx.get(STAMPED_KEYS_CONTEXT_KEY);
  const stamped = existing instanceof Set ? (existing as Set<string>) : new Set<string>();
  for (const key of keys) {
    stamped.add(key);
  }
  ctx.set(STAMPED_KEYS_CONTEXT_KEY, stamped);
}

/**
 * The reserved label keys server-side steps vouched for on this request
 * so far — GuardReservedLabels' exemption set. Empty when nothing was
 * recorded (an empty answer only narrows what passes).
 */
export function serverStampedReservedLabels<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): ReadonlySet<string> {
  const stamped = ctx.get(STAMPED_KEYS_CONTEXT_KEY);
  return stamped instanceof Set ? (stamped as Set<string>) : new Set<string>();
}
