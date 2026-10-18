/**
 * The Environment an open conversation runs in, as its Setup panel shows
 * it: the conversation's own record when the server stamped one (which
 * Environment, and whose choice it was), else why none applies here (the
 * person's own machine, or a server whose conversations run in no sandbox
 * it starts), else none, the server's standard sandbox.
 *
 * The record answers for a governed conversation; the reason for none is
 * read from where the conversation runs, which the record does not carry.
 */
import type { SessionStatus } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { environmentChoiceOfStatus, type EnvironmentChoice, type EnvironmentsNotApplying } from "../environment/resolve.js";

/** The Environment `status` records, or why none applies (`notApplying`, from `environmentsNotApplying`). */
export function conversationEnvironment(
  status: Pick<SessionStatus, "environment" | "environmentSource"> | undefined,
  notApplying: EnvironmentsNotApplying | undefined,
): EnvironmentChoice {
  const recorded = environmentChoiceOfStatus(status);
  if (recorded.kind === "chosen" || notApplying === undefined) {
    return recorded;
  }
  return { kind: notApplying };
}
