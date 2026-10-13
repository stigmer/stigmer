/**
 * The move door's domain step: one account's access inside an organization
 * moves to another account of the same person (bootstrapMoveOrgAccess, a
 * system RPC). An edition that signs people in more than one way calls it
 * when a person proves both accounts are theirs: Stigmer Enterprise, when
 * someone who worked in an organization under an email login signs in
 * through the organization's single sign-on provider and asks for their
 * access to follow them. Open source signs people in one way and never
 * calls it.
 *
 * The rows move through the one grant path (grant-path.ts
 * `moveOrgAccess`), each recorded under the door's own cause,
 * `access_moved`, so a permission history tells a move from a hand grant.
 * The step also says what stops with the move, read before anything is
 * written so the answer is the same for a preview and for the move:
 *
 *   - the source account's My vault in the organization, which its
 *     departure deletes (departure.ts): a My vault is one person's by its
 *     owner, name claim and slug, and a saved sign-in is bound to the
 *     person who saved it, so it cannot move with the rows; the person
 *     saves its entries again;
 *   - the automations that act as the source account there (schedules,
 *     evaluators and evals whose work runs as their creator,
 *     authorization/account-automations.ts), which stop once it holds
 *     nothing, for their owner to make again as the target account.
 *
 * The result is left under MOVED_ORG_ACCESS_KEY for the handler.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  MoveOrgAccessInputSchema,
  MoveOrgAccessResult,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  AccountAutomationSchema,
  MoveOrgAccessResultSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

import type { AccountAutomations } from "../../authorization/account-automations.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { IamPolicyGrantPath } from "./grant-path.js";

/** Where the step leaves its answer for the handler. */
export const MOVED_ORG_ACCESS_KEY = "movedOrgAccess";

/** The entries of a person's My vault in an organization: what its deletion would take. */
export type MyVaultEntries = (
  org: string,
  person: string,
) => Promise<ReadonlyArray<string>>;

export interface MoveOrgAccessDeps {
  readonly grantPath: IamPolicyGrantPath;
  readonly myVaultEntries: MyVaultEntries;
  readonly automations: AccountAutomations;
}

/** The step: what stops, then the move (or its preview), under MOVED_ORG_ACCESS_KEY. */
export function newMoveOrgAccessStep(
  deps: MoveOrgAccessDeps,
): PipelineStep<typeof MoveOrgAccessInputSchema> {
  return {
    name: "MoveOrgAccess",
    async execute(
      ctx: RequestContext<typeof MoveOrgAccessInputSchema>,
    ): Promise<void> {
      const { fromIdentityAccountId, toIdentityAccountId, org, previewOnly } =
        ctx.input;
      const vault = await deps.myVaultEntries(org, fromIdentityAccountId);
      const automations = await deps.automations.actingAs(
        org,
        new Set([fromIdentityAccountId]),
      );
      const moved = await deps.grantPath.moveOrgAccess(
        fromIdentityAccountId,
        toIdentityAccountId,
        org,
        ctx.callerIdentity,
        previewOnly,
      );
      const result: MoveOrgAccessResult = create(MoveOrgAccessResultSchema, {
        movedPolicies: moved,
        myVaultEntries: [...vault],
        automations: automations.map((automation) =>
          create(AccountAutomationSchema, {
            kind: ApiResourceKind[automation.kind],
            id: automation.id,
            slug: automation.slug,
            name: automation.name,
          }),
        ),
      });
      ctx.set(MOVED_ORG_ACCESS_KEY, result);
    },
  };
}
