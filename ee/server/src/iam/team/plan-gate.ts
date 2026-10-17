/**
 * The team lane's plan gate: whether an organization's plan lets it create
 * a team or add a member to one.
 *
 * A host may gate team creation and membership by plan: an organization on
 * a plan without teams keeps its existing teams, their members and every
 * grant to them, but cannot create a team or add someone to one (the
 * contract's `Feature.teams`). The host's billing answers the question;
 * this lane only asks it, through a port the host fills, and with no gate
 * every organization may. It asks at two places: the create chain (the step
 * below) and the member arm of the grant gate (grant-gate.ts). A grant that
 * names a team as the principal on a resource is neither, and is never
 * gated.
 *
 * The port is narrow on purpose, one question about teams rather than a
 * general "does this plan allow feature X". Teams are an edition feature
 * of self-hosted Enterprise, where a license's entitlements never list
 * them; a general entitlement port filled from a license would refuse
 * Enterprise its own teams. So the port is absent there, and absent means
 * allowed.
 *
 * The refusal carries the PLAN_UPGRADE_REQUIRED reason the contract
 * documents on team create and on a team member grant, with the feature
 * and the organization, so a console tells a plan refusal by its reason,
 * never its copy, and shows the copy beside the way to the plans.
 */
import type { PipelineStep, RequestContext } from "@stigmer/server";
import { failedPreconditionError } from "@stigmer/server";

import type { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";

export interface TeamPlanGate {
  /** Whether `orgId`'s plan includes teams right now. */
  allowsTeams(orgId: string): Promise<boolean>;
}

/** The reason a plan refusal carries (stigmer/stigmer's `apis/ai/stigmer/iam/team/v1/command.proto`, create). */
export const PLAN_UPGRADE_REQUIRED = "PLAN_UPGRADE_REQUIRED";

/** The refusal: the organization's plan has no teams, and an upgrade unlocks the act. */
export function teamsNeedAPlan(orgId: string): ReturnType<typeof failedPreconditionError> {
  return failedPreconditionError(
    `Organization '${orgId}' is on a plan without teams; it keeps its existing teams. Upgrade its plan to create a team or add a member.`,
    { reason: PLAN_UPGRADE_REQUIRED, metadata: { feature: "teams", org: orgId } },
  );
}

/** The create chain's step, after BuildNewState: the new team's organization must be on a plan with teams. */
export function newTeamPlanGateStep(gate: TeamPlanGate): PipelineStep<typeof TeamSchema> {
  return {
    name: "TeamPlanGate",
    async execute(ctx: RequestContext<typeof TeamSchema>): Promise<void> {
      const orgId = ctx.newState.metadata?.org ?? "";
      if (!(await gate.allowsTeams(orgId))) {
        throw teamsNeedAPlan(orgId);
      }
    },
  };
}
