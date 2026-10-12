/**
 * The Team RPCs as extension services: TeamCommandController's create,
 * update and delete, TeamQueryController's get, getByReference and
 * listByOrg. Team is an enterprise-tier kind open source registers no
 * service for, so these are its only handlers; every one runs the
 * composition's unary chain (Authorize from the proto annotation, then
 * ValidateProto, then the lane's steps and its domain step).
 *
 * The chains are the OSS steps wherever a step's question is the
 * library's, and the composition's own only where the question reads this
 * table (steps.ts):
 *
 *   create          ResolveSlug → CheckDuplicate → BuildNewState →
 *                   [TeamPlanGate, when the host fills the port] →
 *                   [GrowthGate, likewise (iam/growth-gate.ts)], then
 *                   the row, then the lifecycle driver's creation event
 *   update          LoadExisting → BuildUpdateState, then the row (the
 *                   store keeps the stored slug, store.ts)
 *   rename          the library's rename chain over this table
 *                   (`renameResource`): LoadForRename, ValidateNewSlug,
 *                   RenameName, PersistRenamed through `modifyById`; the
 *                   old slug leads to the team for reading for 30 days
 *   getByReference  LoadByReference → AuthorizeResolvedTarget, as `get`;
 *                   a missing slug or id is NOT_FOUND only to the
 *                   organization's viewers and `get`'s denial to anyone else
 *                   (reference-miss.ts)
 *   get, delete     LoadTarget, then the answer (delete: the removal)
 *
 * Create follows the lifecycle contract every create chain follows: the
 * row is written first, then the creation event (the organization link,
 * which is everything a team's visibility and membership bound hang off);
 * a failed event fails the request with the row in place. The boot's
 * organization-link reconcile (iam/organization-links.ts) restores a link
 * whose policy row never landed, and a policy row whose tuple did not
 * sync heals through the grant path's unsynced row and the boot backfill.
 * Delete does not follow the generic order, for the reason removal.ts
 * gives: a team's grants outlive its row unless they die first.
 *
 * Membership is not a Team RPC: a person joins a team when they are
 * granted `member` on it through the IAM policy service, and the grant
 * gate (grant-gate.ts) is where that grant is checked against the team.
 */
import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { TeamsSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/io_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import type {
  Authorizer,
  ExtensionServiceRegistration,
  Logger,
  NameTable,
  RequestContext,
  ResourceAuthorizationLifecycle,
} from "@stigmer/server";
import {
  callerIdentityOf,
  internalError,
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
  newBuildNewStateStep,
  newBuildUpdateStateStep,
  newClaimNameStep,
  newResolveSlugStep,
  portRenameRows,
  releaseNameOnFailure,
  renameResource,
  resolveResourceCreatedEvent,
  TARGET_RESOURCE_KEY,
} from "@stigmer/server";

import { runUnaryChain } from "../../rpc/unary-chain.js";
import { newGrowthGateStep, type GrowthGate } from "../growth-gate.js";
import { newTeamPlanGateStep, type TeamPlanGate } from "./plan-gate.js";
import type { TeamRemoval } from "./removal.js";
import {
  duplicateTeamError,
  findTeamByName,
  newCheckDuplicateTeamStep,
  newLoadExistingTeamStep,
  newLoadTeamByReferenceStep,
  newLoadTeamStep,
  teamAt,
  teamNameHolder,
} from "./steps.js";
import type { TeamStore } from "./store.js";

export interface TeamLaneDeps {
  readonly authorizer: Authorizer;
  readonly logger: Logger;
  readonly teams: TeamStore;
  /** The server's one name table, where a team's slug is claimed (steps.ts). */
  readonly names: NameTable;
  readonly removal: Pick<TeamRemoval, "remove">;
  /** The composition's one lifecycle driver: creation grants through the grant path. */
  readonly lifecycle: Pick<ResourceAuthorizationLifecycle, "onResourceCreated">;
  /** The host's plan gate (plan-gate.ts); absent, every organization may create teams. */
  readonly planGate?: TeamPlanGate;
  /** The host's growth gate (iam/growth-gate.ts); absent, every create is allowed. */
  readonly growthGate?: GrowthGate;
}

type Commands = ServiceImpl<typeof TeamCommandController>;
type Queries = ServiceImpl<typeof TeamQueryController>;

export function teamCommands(deps: TeamLaneDeps): Commands {
  const method = TeamCommandController.method;
  return {
    create: (input, ctx) =>
      runUnaryChain(
        { chain: "team-create", step: "CreateTeam" },
        method.create,
        input,
        ctx,
        deps,
        (reqCtx) => createTeam(reqCtx, deps),
        {
          kind: ApiResourceKind.team,
          steps: [
            newResolveSlugStep(),
            newCheckDuplicateTeamStep(deps.names, deps.teams),
            newBuildNewStateStep(),
            ...(deps.planGate === undefined ? [] : [newTeamPlanGateStep(deps.planGate)]),
            ...(deps.growthGate === undefined
              ? []
              : [newGrowthGateStep<typeof TeamSchema>(deps.growthGate)]),
            newClaimNameStep<typeof TeamSchema>(
              deps.names,
              ApiResourceKind.team,
              teamNameHolder(deps.teams),
            ),
          ],
        },
      ),
    update: (input, ctx) =>
      runUnaryChain(
        { chain: "team-update", step: "UpdateTeam" },
        method.update,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          await deps.teams.replace(reqCtx.newState);
          return reqCtx.newState;
        },
        {
          kind: ApiResourceKind.team,
          steps: [newLoadExistingTeamStep(deps.teams), newBuildUpdateStateStep()],
        },
      ),
    rename: (input, ctx) =>
      renameResource(
        {
          method: method.rename,
          names: deps.names,
          rows: portRenameRows(TeamSchema, deps.teams),
          authorizer: deps.authorizer,
          logger: deps.logger,
        },
        input,
        callerIdentityOf(ctx),
        ApiResourceKind.team,
      ),
    delete: (input, ctx) =>
      runUnaryChain(
        { chain: "team-delete", step: "DeleteTeam" },
        method.delete,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          const team = teamAt(reqCtx, TARGET_RESOURCE_KEY);
          await deps.removal.remove(
            team.metadata?.id ?? "",
            reqCtx.callerIdentity.identityId,
          );
          return team;
        },
        {
          kind: ApiResourceKind.team,
          steps: [newLoadTeamStep(deps.teams, (del) => del.resourceId)],
        },
      ),
  };
}

export function teamQueries(deps: TeamLaneDeps): Queries {
  const method = TeamQueryController.method;
  return {
    get: (input, ctx) =>
      runUnaryChain(
        { chain: "team-get", step: "GetTeam" },
        method.get,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(teamAt(reqCtx, TARGET_RESOURCE_KEY)),
        {
          kind: ApiResourceKind.team,
          steps: [newLoadTeamStep(deps.teams, (id) => id.value)],
        },
      ),
    getByReference: (input, ctx) =>
      runUnaryChain(
        { chain: "team-get-by-reference", step: "GetTeamByReference" },
        method.getByReference,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(teamAt(reqCtx, TARGET_RESOURCE_KEY)),
        {
          kind: ApiResourceKind.team,
          steps: [
            newLoadTeamByReferenceStep(deps.names, deps.teams, deps.authorizer),
            newAuthorizeResolvedTargetStep(
              deps.authorizer,
              loadedTargetAsMethod(method.get),
            ),
          ],
        },
      ),
    listByOrg: (input, ctx) =>
      runUnaryChain(
        { chain: "team-list-by-org", step: "ListTeams" },
        method.listByOrg,
        input,
        ctx,
        deps,
        async (reqCtx) =>
          create(TeamsSchema, {
            entries: [...(await deps.teams.listByOrg(reqCtx.input.org))],
          }),
      ),
  };
}

/**
 * The create's domain step: the row, then the creation event; ClaimName
 * took the slug in the name table just before. A failure before the row
 * landed lets the name go (releaseNameAfterFailure). A slug the table's
 * unique index refuses, the backstop, answers the duplicate copy.
 */
async function createTeam(
  reqCtx: RequestContext<typeof TeamCommandController.method.create.input>,
  deps: TeamLaneDeps,
): Promise<Team> {
  return insertTeam(reqCtx, deps).catch(
    releaseNameOnFailure(deps.names, deps.logger, reqCtx),
  );
}

async function insertTeam(
  reqCtx: RequestContext<typeof TeamCommandController.method.create.input>,
  deps: TeamLaneDeps,
): Promise<Team> {
  const team = reqCtx.newState;
  const outcome = await deps.teams.insert(team);
  switch (outcome.kind) {
    case "inserted":
      break;
    case "slug-taken": {
      const winner = await findTeamByName(
        deps.names,
        deps.teams,
        team.metadata?.org ?? "",
        team.metadata?.slug ?? "",
      );
      throw duplicateTeamError(winner ?? team);
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unknown insert outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
  const event = resolveResourceCreatedEvent(
    ApiResourceKind.team,
    team,
    reqCtx.callerIdentity,
    deps.logger,
  );
  if (event !== undefined) {
    try {
      await deps.lifecycle.onResourceCreated(event);
    } catch (error) {
      throw internalError(error, "failed to create authorization tuples");
    }
  }
  return team;
}

export function newTeamServiceRegistrations(
  deps: TeamLaneDeps,
): ReadonlyArray<ExtensionServiceRegistration> {
  return [
    (router) => router.service(TeamCommandController, teamCommands(deps)),
    (router) => router.service(TeamQueryController, teamQueries(deps)),
  ];
}
