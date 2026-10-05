/**
 * AuthorizeRunTarget — the run gate (2026-09-11): may this caller RUN what
 * this record targets?
 *
 * Every create that starts or continues a run names a target — a blueprint
 * (`agent`, `workflow`) or a conversation (`session`) — and until this
 * step nothing asked whether
 * the caller may use it: session-create authorized only the organization's
 * `can_create_session`, agent- and workflow-execution create are
 * `is_skip_authorization`, and `can_execute` was defined on every blueprint
 * type of the FGA model and checked nowhere. The invariant the
 * model states ("you can run what you can read") is enforced here.
 *
 * One shared step, one domain resolver: the shape of IndexSearch (a shared
 * step over a domain extractor). The resolver is a PURE function of the
 * record being built (`ctx.newState`, where the chain's own resolution
 * steps write) and, on an update, the stored row (EXISTING_RESOURCE_KEY),
 * so a resolver can ask only about what a write introduces; it names the
 * target and the domain's byte-pinned deny copy, and this step hands it to
 * authorizeResolvedResource — the
 * mid-chain resolved-id form (the ListVersions and listByChannel
 * precedent) for lanes the position-1 annotation cannot express. A
 * resolver that answers no target makes NO check: the chain's own
 * invariant guards (EnsureSessionOrAgentResolved; ValidateProto, which
 * refuses a workflow run naming no workflow) own the shape-less arm, and
 * this step never second-guesses them.
 *
 * Position, in every chain: immediately after the step that guarantees the
 * target reference exists — before EnsureEngineAvailable (a denied caller
 * learns nothing about engine state), before every gate slot, before every
 * side effect the chain owns. The chains' own convention, Authorize before
 * Validate, is what places it there. A chain that asks two questions (a
 * turn: may the caller add to this conversation, then may it still run the
 * conversation's agent) runs the step twice under two names, each after the
 * step that resolves its target.
 *
 * Admission has one owner per lane. This step asks for EVERY caller but the
 * `internal` class (authorizeResolvedResource's contract): a direct
 * principal is admitted by the Authorizer; a runtime lane (a guest share, a
 * channel, a schedule fire, a workflow sandbox's child run) is admitted by
 * the gate step that vouches for it, and the edition's Authorizer says so
 * for the lanes it mints — the OSS chain stays policy-free. RUN_GATE_CHECKS
 * is the one definition of "the run-gate checks" that such an Authorizer
 * keys on (isRunGateCheck, exported on the barrel); the resolvers draw their
 * (kind, permission) pairs from the same table, so the predicate cannot
 * drift from what the step actually asks.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../extensions/authorizer.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { authorizeResolvedResource } from "./authorize.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";

/** One (kind, permission) pair the run gate asks about. */
export interface RunGateCheck {
  readonly permission: IamPermission;
  readonly resourceKind: ApiResourceKind;
}

/**
 * The run-gate check set — exactly the pairs a resolver can produce. Each
 * is the FGA model's own relation for "may run this": `can_execute` on the
 * blueprints (`agent.fga` and `workflow.fga`, `can_execute: viewer`), and
 * `can_create_execution_in` on a session (`session.fga`: adding a turn to a
 * conversation is the session's own permission, not the agent's).
 */
export const RUN_GATE_CHECKS = {
  agent: {
    permission: IamPermission.can_execute,
    resourceKind: ApiResourceKind.agent,
  },
  session: {
    permission: IamPermission.can_create_execution_in,
    resourceKind: ApiResourceKind.session,
  },
  workflow: {
    permission: IamPermission.can_execute,
    resourceKind: ApiResourceKind.workflow,
  },
} as const satisfies Record<string, RunGateCheck>;

const RUN_GATE_CHECK_LIST: ReadonlyArray<RunGateCheck> =
  Object.values(RUN_GATE_CHECKS);

/**
 * Whether `check` is one of the run gate's — the predicate an edition's
 * Authorizer keys its lane admission on. Reads only the pair (an AuthzCheck
 * is one); the resource id is the target's identity, not part of the
 * question.
 */
export function isRunGateCheck(check: RunGateCheck | AuthzCheck): boolean {
  return RUN_GATE_CHECK_LIST.some(
    (candidate) =>
      candidate.permission === check.permission &&
      candidate.resourceKind === check.resourceKind,
  );
}

/**
 * A resolved run target: the check plus the domain's byte-pinned deny copy
 * for it (the lane's error_msg, in the position-1 annotation's terms).
 */
export interface RunTarget extends RunGateCheck {
  readonly resourceId: string;
  readonly deniedMessage: string;
}

/**
 * Names a record's run target, or `undefined` when the record names none
 * (a state the chain's own guards refuse, or one with nothing to run).
 * `stored` is the row an update replaces, absent on a create. Pure over the
 * two records — no store, no clock, no caller.
 */
export type RunTargetResolver<Desc extends DescMessage> = (
  record: MessageShape<Desc>,
  stored: MessageShape<Desc> | undefined,
) => RunTarget | undefined;

/**
 * The run gate under its step name: `AuthorizeRunTarget`, or
 * `AuthorizeRunAgent` for a chain's second question (the module header).
 */
export function newAuthorizeRunTargetStep<Desc extends DescMessage>(
  authorizer: Authorizer,
  resolveRunTarget: RunTargetResolver<Desc>,
  name: "AuthorizeRunTarget" | "AuthorizeRunAgent" = "AuthorizeRunTarget",
): PipelineStep<Desc> {
  return {
    name,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const target = resolveRunTarget(
        ctx.newState,
        ctx.get(EXISTING_RESOURCE_KEY) as MessageShape<Desc> | undefined,
      );
      if (target === undefined) {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: target.permission,
          resourceKind: target.resourceKind,
          resourceId: target.resourceId,
        },
        target.deniedMessage,
      );
    },
  };
}
