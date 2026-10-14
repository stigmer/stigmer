/**
 * Who may create an organization on a licensed self-hosted server: the
 * operator's list (`STIGMER_ORGANIZATION_CREATORS`, read by
 * editions/enterprise-config.ts), enforced by one step on the library's
 * `org-create:pre-side-effect-gate`, ahead of the growth gate (who may,
 * before whether the license still grows). The license unit registers it
 * only when a list is set; unset, anyone signed in may create one, the
 * library's own contract.
 *
 * The list names accounts by id (`ida_` and 26 lowercase Crockford-base32
 * characters), the server-side name `stigmer auth whoami` prints and the
 * refusal itself repeats. An id is stable and unique across sign-in lanes,
 * and an API key acts as its creator's account, so a listed person's key
 * may create and an unlisted person's may not, with no rule of its own.
 * An email is not a key here: no lane reads `email_verified`.
 *
 * For each create the step:
 *
 *   - admits the server acting as itself (caller class `internal`), so a
 *     license of one organization still makes its organization at boot
 *     through the same chain (the library's boot/single-organization.ts);
 *   - admits a child organization, read from the state about to be
 *     written, as ValidateChildOrganization reads it: that step has
 *     already asked `can_manage_child_orgs` on the parent, because
 *     managing an organization's children is managing the organization;
 *   - otherwise judges the caller's account, the principal every other
 *     decision on the server sees. A caller of the operator's OIDC lane
 *     whose account does not exist yet carries its subject, so its account
 *     is the id derived from that subject, the one its first sign-in will
 *     make; an unlisted account is refused with PERMISSION_DENIED carrying
 *     `ORGANIZATION_CREATOR_NOT_LISTED` and the caller's own account id,
 *     before anything is written.
 *
 * The step reads nothing and writes nothing. It sits after the library's
 * own organization limit, so an unlisted person on a server at its limit
 * hears the limit first; either refusal tells them they cannot create one.
 */
import type { PipelineStep, RequestContext } from "@stigmer/server";
import { accountIdFor, permissionDeniedWithReasonError } from "@stigmer/server";
import type { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/** The refusal's ErrorInfo reason, documented on OrganizationCommandController.create. */
export const ORGANIZATION_CREATOR_NOT_LISTED = "ORGANIZATION_CREATOR_NOT_LISTED";

/** The step's name, in the slot's registration and every test that picks it. */
export const ORGANIZATION_CREATORS_STEP = "OrganizationCreators";

/** An account id's shape: `ida_` and 26 lowercase Crockford-base32 characters. */
const ACCOUNT_ID = /^ida_[0-9a-hjkmnp-tv-z]{26}$/;

/** Whether `value` has an account id's exact shape (not whether the account exists). */
export function isAccountId(value: string): boolean {
  return ACCOUNT_ID.test(value);
}

/** The copy every client shows verbatim, naming the caller's own account id. */
export function creatorNotListedMessage(account: string): string {
  return `Only the accounts this server's operator lists can create an organization, and yours (${account}) is not one of them. To join an organization, ask one of its admins to invite you; to create one, send the operator your account id.`;
}

/** The gate step that admits only the listed accounts' top-level creates. */
export function newOrganizationCreatorsStep(
  creators: ReadonlySet<string>,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: ORGANIZATION_CREATORS_STEP,
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const caller = ctx.callerIdentity;
      if (caller.callerClass === "internal") {
        return;
      }
      if ((ctx.newState.spec?.parentOrg ?? "") !== "") {
        return;
      }
      const account = isAccountId(caller.identityId)
        ? caller.identityId
        : accountIdFor(caller.identityId);
      if (creators.has(account)) {
        return;
      }
      throw permissionDeniedWithReasonError(creatorNotListedMessage(account), {
        reason: ORGANIZATION_CREATOR_NOT_LISTED,
        metadata: { account },
      });
    },
  };
}
