/**
 * Which runner serves a conversation's turns: the ONE rule, read by the
 * conversation's stamp (session create), dispatch (the queue a turn's runner
 * activities go to), the Environment policy (whether a server-started
 * sandbox runs a conversation) and every edition's gate that asks "does a
 * sandbox serve this turn". It is pure, as `resolveExecutionTarget` is the
 * one pure rule for targets (oss#397), so none of them can disagree.
 *
 * Two steps, so a conversation never moves:
 *
 *   - `sharedRunnerFor` decides, while a conversation is made (and on each
 *     write until its first turn), whether a runner the server shares serves
 *     it: per-session routing, shared runners on (STIGMER_SHARED_RUNNER_KEY),
 *     a CLOUD target and no computer (computer.ts `hasComputer`: only
 *     COMPUTER_NONE means none). The answer is stamped on the conversation
 *     (`SessionStatus.shared_runner`) and kept for its whole life.
 *   - `placeTurn` places each turn by that stamp, never by the server's
 *     settings at the time. A shared runner and a sandbox each keep a
 *     conversation's saved state where they run it, so switching shared
 *     runners on or off must not move a conversation that already exists:
 *     one made before stays in its sandbox, and one stamped shared on a
 *     server whose shared runners are now off is refused its turn
 *     (`SHARED_RUNNERS_OFF_MESSAGE`), never moved.
 *
 * Three answers:
 *
 *   - `sandbox`: the conversation's own queue (`session:<id>`), served by a
 *     sandbox this server's driver starts: per-session routing, a CLOUD
 *     target, a sandbox driver composed, and no shared-runner stamp.
 *   - `shared`: the runner queue (`stigmer_runner`): global routing, as
 *     always, a turn with no session id (per-session routing has no queue to
 *     derive), and a conversation stamped shared.
 *   - `own`: the conversation's own queue, served by no sandbox of this
 *     server: a person's own runner (the desktop app, `stigmer up` under
 *     session routing, a LOCAL target), or a CLOUD target with no driver
 *     (an operator-managed runner polls each session's queue).
 *
 * A caller judging a turn before its session exists (an edition's gate at
 * the run's create) asks `sharedRunnerFor` with the agent's computer
 * (computer.ts `agentComputer`), as the session will be stamped.
 *
 * Tests: __tests__/placement.test.ts.
 */
import { ExecutionTarget, type Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { hasComputer } from "./computer.js";
import { ROUTING_SESSION } from "./temporal/config.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";

/** Which runner serves a turn (the module header). */
export type TurnPlacement = "own" | "sandbox" | "shared";

/** The server's config as the rule reads it: routing, the target rule, and whether shared runners are on. */
export type PlacementConfig = Pick<AgentExecutionTemporalConfig, "activityRouting" | "resolveExecutionTarget" | "sharedRunners">;

export interface SharedRunnerFacts {
  readonly config: PlacementConfig;
  /** The conversation's raw target (UNSPECIFIED resolves through the config). */
  readonly target: ExecutionTarget;
  /** The conversation's computer, or its agent's for a session not made yet. */
  readonly computer: Computer | undefined;
}

/** Whether a runner the server shares serves a conversation made now: the stamp's rule (the module header). */
export function sharedRunnerFor(facts: SharedRunnerFacts): boolean {
  const { config } = facts;
  return (
    config.activityRouting === ROUTING_SESSION &&
    config.sharedRunners &&
    config.resolveExecutionTarget(facts.target) === ExecutionTarget.CLOUD &&
    !hasComputer(facts.computer)
  );
}

export interface PlacementFacts {
  readonly config: PlacementConfig;
  /** The conversation's raw target (UNSPECIFIED resolves through the config). */
  readonly target: ExecutionTarget;
  /** The conversation's stamp (`SessionStatus.shared_runner`). */
  readonly sharedRunner: boolean;
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
  if (facts.sharedRunner) {
    return "shared";
  }
  return facts.sandboxLane ? "sandbox" : "own";
}

/**
 * The refusal of a turn of a conversation stamped shared on a server whose
 * shared runners are off: its saved state is on a shared runner, so it is
 * never moved to a sandbox.
 */
export const SHARED_RUNNERS_OFF_MESSAGE =
  "this conversation runs on shared runners, which this server no longer has; start a new conversation";

/** Whether a server-started sandbox runs a conversation with a computer on this target (the Environment policy's question). */
export function sandboxServesTarget(config: PlacementConfig, sandboxLane: boolean, target: ExecutionTarget): boolean {
  // Any session id: the question is about a conversation, which always has one.
  return placeTurn({ config, target, sharedRunner: false, sandboxLane, sessionId: "-" }) === "sandbox";
}
