/**
 * The run-lanes driver point: which lane an edition's visitors' turns come
 * through, and what that lane's settings, operator profile and approval
 * mode are. Single instance, registered as `drivers.runLanes`.
 *
 * A turn's settings are resolved once, at create, by ResolveRunConfig
 * (domain/run/resolve-run-config.ts) from three layers: the
 * turn's own (the request, or the surface it came through), the defaults of
 * the agent it runs, and the lane's operator profile. The core knows its own
 * lanes: a schedule's fire (the reserved schedule label) and everything
 * else (interactive). An edition
 * that admits outsiders (the cloud's shared-agent guests and channel
 * senders) composes their turns on lanes the core never names: OSS never
 * learns the lane names (the visitor classifier's doctrine,
 * extensions/visitor-classifier.ts); it asks this point. Absent means no
 * such lanes, which is true of open source.
 *
 * The contract:
 *   - Asynchronous, because a lane's settings are its surface's saved
 *     settings (a share's, a channel's), read by one point read keyed on the
 *     caller's verified identity, never on anything the request carries.
 *   - Consulted before the pre-side-effect gate slot and before the
 *     settings are validated, so the checks judge what will actually run on
 *     every lane and nothing has been reserved or written when they refuse.
 *   - Answering a lane replaces the request's run_config with the lane's
 *     `settings`: a visitor's own settings are never consulted. It does not
 *     touch the per-message intents at the top of the spec
 *     (interaction_mode, build_from_plan, structured_output_schema) nor
 *     auto_approve_all: whether a visitor may set them is the edition's
 *     call, made in its own gate steps (the hosted edition clears all four
 *     for a share's guest).
 *   - A throw fails the create (the store-fault posture of every create
 *     step); answering nothing means the turn is the core's to place.
 */
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { ApprovalMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunConfig } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";

import type { CallerIdentity } from "./identity.js";

/** One edition lane's answer for a turn. */
export interface RunLane {
  /**
   * The surface's saved settings, which become the turn's own layer in
   * place of the request's run_config. Undefined: the surface saved none.
   */
  readonly settings?: RunConfig;
  /**
   * How a refusal names `settings` when a value from it is refused at
   * create, e.g. "the share's run_config".
   */
  readonly settingsName: string;
  /** The lane's operator profile: the last layer for choices, a ceiling for bounds. */
  readonly profile?: RunConfig;
  /** How the turn resolves approval gates: INTERACTIVE or UNATTENDED. */
  readonly approvalMode: ApprovalMode;
}

/** The run-lanes contract (single-instance point, ExtensionDrivers.runLanes). */
export interface RunLanes {
  /** The edition lane `execution` comes through for `caller`, or undefined. */
  laneOf(
    caller: CallerIdentity,
    execution: Run,
  ): Promise<RunLane | undefined>;
}
