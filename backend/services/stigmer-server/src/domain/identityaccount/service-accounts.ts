/**
 * An organization's service accounts: createServiceAccount and
 * listServiceAccounts. A service account is an identity account in the
 * `service_account` provisioning mode, the principal an organization's
 * automation acts as through API keys its admins create for it
 * (ApiKeyCommandController.createForServiceAccount), so the automation
 * keeps working when the person who set it up leaves.
 *
 * Create, in order, each through the path every other write of its kind
 * takes:
 *
 *   1. authorization on the organization (`can_create_identity_account`,
 *      its admins) and the refusal of a service account's own key;
 *   2. sign-in must be on: without it no API-key verifier is composed, so
 *      no key could ever authenticate as the account (FAILED_PRECONDITION);
 *   3. the name is unique among the organization's service accounts, by
 *      the slug it fits to (`fittedSlug`), the same column an edition that
 *      keeps its own table holds unique. Open source checks before the
 *      write, the read-then-write posture of every chain on the platform
 *      (resource-store.ts); a held name is ALREADY_EXISTS;
 *   4. the account, through the domain's one create path (controller.ts
 *      `newCreateAccountPath`) as the admin: subject
 *      `stgm_sa|<org>|<random>` (constants.ts), `metadata.org` the
 *      organization, the provisioning arm `service_account`;
 *   5. the organization link, announced to an edition that stores tuples
 *      (`onServiceAccountLinked`; open source derives it from the row,
 *      authorization/model/service-accounts.ts);
 *   6. its organization role, through the grant path with the cause
 *      `service_account_created`, so the grant's history names the admin.
 *
 * A fault after the row is written answers INTERNAL with the row in
 * place, the lifecycle contract every create chain keeps: the account is
 * listed, and its admins can delete it.
 *
 * List reads the organization's accounts (`findByOrg`) and keeps the
 * service accounts, newest first, so one whose role was removed is still
 * found and can be deleted.
 *
 * Proven by __tests__/service-accounts.test.ts and the service-account
 * conformance suite.
 */
import type { HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountsListSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import type {
  CreateServiceAccountInput,
  IdentityAccountsList,
  ListWithIdentityOrg,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  alreadyExistsWithReasonError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { refuseServiceAccountCaller } from "../../pipeline/steps/refuse-service-account.js";
import { fittedSlug } from "../../pipeline/steps/slug.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { organizationRole } from "../iampolicy/specs.js";
import { isServiceAccount } from "./actor.js";
import {
  SERVICE_ACCOUNTS_NEED_SIGN_IN_MESSAGE,
  serviceAccountNameTakenMessage,
  serviceAccountSubjectFor,
} from "./constants.js";
import type { CreateAccount } from "./provisioning.js";
import type { IdentityAccountStore } from "./store.js";

/** The reason a held name is refused with, so a client tells it apart without parsing text. */
export const SERVICE_ACCOUNT_NAME_TAKEN = "SERVICE_ACCOUNT_NAME_TAKEN";

/** A name that fits to no slug (INVALID_ARGUMENT). */
export const SERVICE_ACCOUNT_NAME_UNUSABLE_MESSAGE =
  "a service account's name needs at least one ASCII letter or digit";

/** The page size listServiceAccounts answers when the request names none, and its ceiling. */
const LIST_PAGE_SIZE = 100;

export interface ServiceAccountDeps {
  readonly accounts: IdentityAccountStore;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  /** The lifecycle the account's controller fires; its optional `onServiceAccountLinked` is the link. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly createAccount: CreateAccount;
  readonly grantPath: Pick<IamPolicyGrantPath, "grant">;
  /** Whether sign-in is on; false under the trusted-local posture. */
  readonly signInRequired: boolean;
}

/** The act a service account's own key is refused here. */
const CREATE_ACT = "create service accounts";

export async function createServiceAccount(
  deps: ServiceAccountDeps,
  input: CreateServiceAccountInput,
  ctx: HandlerContext,
): Promise<IdentityAccount> {
  const caller = callerIdentityOf(ctx);
  await authorizeDirect(
    IdentityAccountCommandController.method.createServiceAccount,
    deps.authorizer,
    caller,
    input,
  );
  await refuseServiceAccountCaller(caller, CREATE_ACT, deps.accounts);
  if (!deps.signInRequired) {
    throw failedPreconditionError(SERVICE_ACCOUNTS_NEED_SIGN_IN_MESSAGE);
  }
  if (!isServiceAccountRole(input.role)) {
    // protovalidate refuses these on the wire; a composed request is held
    // to the same rule.
    throw invalidArgumentError(
      "role must be admin, member or viewer; a service account never owns its organization",
    );
  }
  const org = input.org;
  const slug = serviceAccountSlugOf(input.name);
  await refuseTakenName(deps.accounts, org, slug, input.name, undefined);

  const account = await deps.createAccount(
    {
      name: input.name,
      slug,
      spec: create(IdentityAccountSpecSchema, {
        idpId: serviceAccountSubjectFor(org),
      }),
      provisioning: { mode: "service_account", org },
    },
    caller,
  );
  const accountId = account.metadata?.id ?? "";
  try {
    await deps.authorizationLifecycle?.onServiceAccountLinked?.({
      accountId,
      orgId: org,
      caller,
    });
    await deps.grantPath.grant(
      organizationRole(accountId, input.role, org),
      caller,
      "service_account_created",
    );
  } catch (error) {
    deps.logger.error(
      "service account created but its organization link or role failed; the account is listed and can be deleted",
      {
        accountId,
        org,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw internalError(error, "failed to give the service account its role");
  }
  deps.logger.info("service account created", {
    accountId,
    org,
    role: IamRole[input.role],
    createdBy: caller.identityId,
  });
  return account;
}

export async function listServiceAccounts(
  deps: ServiceAccountDeps,
  input: ListWithIdentityOrg,
  ctx: HandlerContext,
): Promise<IdentityAccountsList> {
  await authorizeDirect(
    IdentityAccountQueryController.method.listServiceAccounts,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  const all = await serviceAccountsOf(deps.accounts, input.org);
  const size = clampPageSize(input.page?.size ?? 0);
  const num = Math.max(input.page?.num ?? 0, 1);
  const start = (num - 1) * size;
  return create(IdentityAccountsListSchema, {
    totalPages: Math.ceil(all.length / size),
    entries: start >= all.length ? [] : all.slice(start, start + size),
  });
}

/**
 * The slug a service account's name fits to: its uniqueness key, and the
 * slug its row carries, kept equal to its name on every rename
 * (controller.ts). A name with no ASCII letter or digit fits to none.
 */
export function serviceAccountSlugOf(name: string): string {
  try {
    return fittedSlug(name);
  } catch {
    throw invalidArgumentError(SERVICE_ACCOUNT_NAME_UNUSABLE_MESSAGE);
  }
}

/**
 * Refuses a service-account name another service account of `org` holds;
 * `self` is the account being renamed, which may keep its own name.
 */
export async function refuseTakenName(
  accounts: Pick<IdentityAccountStore, "findByOrg">,
  org: string,
  slug: string,
  name: string,
  self: string | undefined,
): Promise<void> {
  const held = (await serviceAccountsOf(accounts, org)).some(
    (account) =>
      (account.metadata?.slug ?? "") === slug &&
      (account.metadata?.id ?? "") !== self,
  );
  if (held) {
    throw alreadyExistsWithReasonError(serviceAccountNameTakenMessage(name), {
      reason: SERVICE_ACCOUNT_NAME_TAKEN,
    });
  }
}

/** The organization's service accounts, newest first; a fault is INTERNAL. */
async function serviceAccountsOf(
  accounts: Pick<IdentityAccountStore, "findByOrg">,
  org: string,
): Promise<IdentityAccount[]> {
  let rows: ReadonlyArray<IdentityAccount>;
  try {
    rows = await accounts.findByOrg(org);
  } catch (error) {
    throw internalError(error, "failed to list the organization's accounts");
  }
  return rows
    .filter(isServiceAccount)
    .sort((a, b) =>
      compareCreatedAtDesc(
        a.status?.audit?.specAudit?.createdAt,
        b.status?.audit?.specAudit?.createdAt,
      ),
    );
}

function isServiceAccountRole(role: IamRole): boolean {
  return (
    role === IamRole.admin || role === IamRole.member || role === IamRole.viewer
  );
}

function clampPageSize(size: number): number {
  return size <= 0 || size > LIST_PAGE_SIZE ? LIST_PAGE_SIZE : size;
}

