/**
 * Which runner serves a turn: the ONE rule, read by dispatch (the queue a
 * turn's runner activities go to), the turn's sandbox ensure (whether to
 * ask for one), the Environment policy (whether a server-started sandbox
 * runs a conversation) and every edition's gate that asks "does a sandbox
 * serve this turn". It is pure, as `resolveExecutionTarget` is the one
 * pure rule for targets (oss#397), so none of them can disagree.
 *
 * Three answers:
 *
 *   - `sandbox`: the conversation's own queue (`session:<id>`), served by a
 *     sandbox this server's driver starts. Per-session routing, a CLOUD
 *     target, a sandbox driver composed, and a conversation with a
 *     computer (or shared runners off).
 *   - `shared`: the runner queue (`stigmer_runner`), served by runners the
 *     operator runs for many conversations. Global routing, as always; and,
 *     under per-session routing with shared runners on
 *     (STIGMER_SHARED_RUNNER_KEY), a CLOUD-target conversation without a
 *     computer: such a turn needs no machine of its own, so it starts
 *     without waiting for one.
 *   - `own`: the conversation's own queue, served by no sandbox of this
 *     server: a person's own runner (the desktop app, `stigmer up` under
 *     session routing, a LOCAL target), or a CLOUD target with no driver
 *     (an operator-managed runner polls each session's queue).
 *
 * Shared runners are switched on by the operator, never by a driver being
 * composed: a server whose environment sets no key places every turn as
 * before, so an edition can take this code before any runner polls the
 * shared queue. A turn with an empty session id goes to the runner queue
 * (per-session routing has no queue to derive), as before.
 *
 * The computer is the conversation's stamp (`SessionStatus.computer`), read
 * by the proto's rule (computer.ts `hasComputer`: only COMPUTER_NONE means
 * none); a turn whose session does not exist yet reads its agent's, as the
 * session will be stamped (computer.ts `agentComputer`).
 *
 * Tests: __tests__/placement.test.ts.
 */
import { Computer, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { hasComputer } from "./computer.js";
import { ROUTING_SESSION } from "./temporal/config.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";

/** Which runner serves a turn (the module header). */
export type TurnPlacement = "own" | "sandbox" | "shared";

export interface PlacementFacts {
  /** The server's config: routing mode, the target rule, and whether shared runners are on. */
  readonly config: Pick<AgentExecutionTemporalConfig, "activityRouting" | "resolveExecutionTarget" | "sharedRunners">;
  /** The conversation's raw target (UNSPECIFIED resolves through the config). */
  readonly target: ExecutionTarget;
  /** The conversation's computer stamp, or its agent's for a session not made yet. */
  readonly computer: Computer | undefined;
  /** Whether this server starts sandboxes (a driver is composed). */
  readonly sandboxLane: boolean;
  /** The turn's session id; empty for a turn with none. */
  readonly sessionId: string;
}

/** The one placement rule (the module header). */
export function placeTurn(facts: PlacementFacts): TurnPlacement {
  const { config } = facts;
  if (config.activityRouting !== ROUTING_SESSION || facts.sessionId === "") {
    return "shared";
  }
  if (config.resolveExecutionTarget(facts.target) !== ExecutionTarget.CLOUD) {
    return "own";
  }
  if (config.sharedRunners && !hasComputer(facts.computer)) {
    return "shared";
  }
  return facts.sandboxLane ? "sandbox" : "own";
}

/** Whether a server-started sandbox runs a conversation with a computer on this target (the Environment policy's question). */
export function sandboxServesTarget(
  config: PlacementFacts["config"],
  sandboxLane: boolean,
  target: ExecutionTarget,
): boolean {
  // Any session id: the question is about a conversation, which always has one.
  return placeTurn({ config, target, computer: Computer.REQUIRED, sandboxLane, sessionId: "-" }) === "sandbox";
}
