/**
 * Whether a conversation has run: any run row in it, read through the run
 * list index's session key, exact whoever wrote the rows. A run row is the
 * fact every harness leaves (stigmer/stigmer#2566, #2598), so this is the
 * one predicate an update's locks judge by: the harness, the execution
 * target (steps.ts) and the conversation's own Environment
 * (resolve-session-environment.ts) are each fixed once it has run.
 *
 * The answer is read once per request: the first lock that needs it reads
 * the rows and later ones reuse it, so an update pays at most one query. A
 * store fault is Internal, never a reading of the session.
 *
 * Proven by __tests__/session.test.ts (the three locks over the wire) and
 * __tests__/resolve-session-environment.test.ts.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

import { internalError } from "../../pipeline/errors.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";
import { agentExecutionListIndex } from "../run/list-index.js";

/** Context key for the request's memoised answer. */
const SESSION_HAS_RUN_KEY = "sessionHasRun";

export async function sessionHasRun<Desc extends DescMessage>(
  store: Store,
  ctx: RequestContext<Desc>,
  session: Session,
): Promise<boolean> {
  const known = ctx.get(SESSION_HAS_RUN_KEY);
  if (typeof known === "boolean") {
    return known;
  }
  let hasRun: boolean;
  try {
    const rows = await store.queryResources(agentExecutionListIndex, {
      anyKey: [{ name: "session", value: session.metadata?.id ?? "" }],
      limit: 1,
    });
    hasRun = rows.length > 0;
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }
  ctx.set(SESSION_HAS_RUN_KEY, hasRun);
  return hasRun;
}
