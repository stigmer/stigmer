/**
 * The Invitation chains' own steps: the read the OSS chain steps need done
 * over the composition's table (`ee.iam_invitation`) because the
 * library's version reads its Store, and the redemption's caller guard.
 * The read keeps the OSS step's name and copy, so a failure log and a
 * refusal read the same whichever edition served it (Team's steps.ts is
 * the shape). A create's id needs no step here: the library's
 * BuildNewState mints it whatever the request carried.
 *
 *   LoadTarget      a read or a revoke by id, under TARGET_RESOURCE_KEY
 *   RefuseNonPersonCaller
 *                   redeem admits a person only (`isPersonCaller`), before
 *                   the token is looked up: the grant lands on the
 *                   caller's identity, and for a guest token that identity
 *                   is the organization's one shared guest account, so one
 *                   anonymous redemption would hand the link's role to
 *                   every visitor. Refusing before the
 *                   read also keeps a non-person from learning whether a
 *                   token exists
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import type { PipelineStep, RequestContext } from "@stigmer/server";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
  TARGET_RESOURCE_KEY,
} from "@stigmer/server";

import { isPersonCaller } from "../grant/roles.js";
import type { InvitationStore } from "./store.js";

/** The kind's display name in refusal copy, as the OSS steps render it. */
export const INVITATION_DISPLAY_NAME = "Invitation";

/** Redeem's refusal of a caller that is not a person; pinned, clients match on it. */
export const REDEEM_NOT_A_PERSON = "an invitation is redeemed by a person signed in to their own account";

/** A read by id, for `get` and `revoke`; `idOf` names the request's id field. */
export function newLoadInvitationStep<Desc extends DescMessage>(
  invitations: Pick<InvitationStore, "findById">,
  idOf: (input: MessageShape<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = idOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      const invitation = await invitations.findById(id);
      if (invitation === undefined) {
        throw notFoundError(INVITATION_DISPLAY_NAME, id);
      }
      ctx.set(TARGET_RESOURCE_KEY, invitation);
    },
  };
}

/** Redeem's caller guard: a person only, before any read (see the header). */
export function newRefuseNonPersonCallerStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "RefuseNonPersonCaller",
    execute(ctx: RequestContext<Desc>): void {
      if (!isPersonCaller(ctx.callerIdentity)) {
        throw new ConnectError(REDEEM_NOT_A_PERSON, Code.PermissionDenied);
      }
    },
  };
}

/** The row a load step stashed under `key`; the chain guarantees it. */
export function invitationAt(
  ctx: { get(key: string): unknown },
  key: string,
): Invitation {
  const invitation = ctx.get(key) as Invitation | undefined;
  if (invitation === undefined) {
    throw internalError(
      new Error(`no invitation under ${key}`),
      "invitation chain lost its loaded resource",
    );
  }
  return invitation;
}
