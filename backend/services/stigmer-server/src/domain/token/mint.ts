/**
 * The user-token mint: `mintUserToken`, the RPC an organization's product
 * backend calls with a service account's API key and one of its people,
 * answered with a short-lived Stigmer user token for that person. The
 * shape every payments or messaging platform gives its server key: one
 * call, no credential kind of its own.
 *
 * Who may mint, in order:
 *
 *   1. The server can sign: a server that trusts every request has no
 *      key ring, and one without a signing key cannot sign
 *      (FAILED_PRECONDITION either way).
 *   2. The caller is a service account (PERMISSION_DENIED otherwise): a
 *      person minting tokens for strangers is not a pattern anyone needs,
 *      and an admin's own session must not quietly become a mint.
 *   3. Authorization, from the method's annotation:
 *      `can_mint_user_tokens` on the organization the token is for, its
 *      admins and its parent's admins (fga/model/tenancy/organization.fga).
 *      A management permission, so a key bound to its organization reaches
 *      a child of it (authorization/credential-binding.ts) and nothing
 *      else.
 *
 * The settings that apply (create_accounts_on_sign_in, sign_in_role) are
 * the minting service account's organization's embedding settings
 * (domain/organization/embedding.ts), read once per mint; a child the
 * token is for is served by its parent's settings.
 *
 * The person is keyed `stgm_pc|<org>|<user_id>` with the token's
 * organization, so every mint for one organization resolves one person to
 * one account there, and that account's id is derived from the subject
 * (identityaccount/constants.ts accountIdFor). An account that exists is
 * used as it is (its roles and profile stay what they are) and must be an
 * app user's: the subject namespace is reserved in both directions. An
 * account that does not exist is created when the settings allow it, in
 * this order:
 *
 *   1. The account's input is built and validated, so nothing below runs
 *      for a person the create path would refuse.
 *   2. When the settings name a sign-in role (never owner), it is granted
 *      on the token's organization to the DERIVED account id, before the
 *      account row exists. The grant path is idempotent, and an account
 *      belongs to that one organization alone (its subject names it), so
 *      its creation is its one first sign-in there.
 *   3. The account is created through the identity-account domain's one
 *      create path, in `app_user` mode. A concurrent first mint that won
 *      the race is read back.
 *
 * Granting first makes every failure retry-safe with nothing to undo: a
 * failed grant has written nothing; a failed create leaves one policy row
 * naming an account that does not exist yet, which the next mint for that
 * person completes.
 *
 * Who acts: the account and the grant are written as the server acting
 * for the minting service account (`serverActingFor`), so the account's
 * audit and the access history name the machine that let the person in,
 * and the grant is an ordinary `grant`, the way a federated sign-in's is
 * recorded for its federation issuer. The service account's own key is
 * refused every account and organization-role write on the wire; this is
 * the one place its organization's admins let it do either, bounded by
 * the role they set in the embedding settings.
 *
 * The email and name in the token and on the account are the product's
 * assertion; nothing on the server derives authority from either.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import type {
  MintUserTokenRequest,
  MintUserTokenResponse,
} from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import {
  MintUserTokenResponseSchema,
  TokenService,
} from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { OrganizationEmbedding } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  boundOrgOf,
  isServiceAccountCaller,
} from "../../extensions/identity.js";
import { internalError } from "../../pipeline/errors.js";
import { serverActingFor } from "../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { fittedName } from "../../pipeline/steps/slug.js";
import { validator } from "../../pipeline/steps/validation.js";
import {
  canSign,
  type PlatformTokenKeyRing,
} from "../../platformtoken/key-ring.js";
import { signPlatformToken } from "../../platformtoken/envelope.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { organizationRole } from "../iampolicy/specs.js";
import {
  APP_USER_SUBJECT_PREFIX,
  accountIdFor,
} from "../identityaccount/constants.js";
import type {
  CreateAccount,
  CreateAccountInput,
} from "../identityaccount/provisioning.js";
import { resolveCreateRace } from "../identityaccount/provisioning.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import { isGrantableSignInRole } from "../organization/embedding.js";
import {
  BEARER_TOKEN_TYPE,
  MINTING_DISABLED_MESSAGE,
  MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
  MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
  OWNER_SIGN_IN_ROLE_MESSAGE,
  PROVISIONING_FAILED_MESSAGE,
  USER_TOKEN_CLAIMS,
  blankSubjectPartMessage,
  foreignAccountMessage,
  noAccountMessage,
  signInRoleNotGrantableMessage,
  subjectSeparatorMessage,
} from "./constants.js";

/** The separator of the composite subject; neither part may contain it. */
const SUBJECT_SEPARATOR = "|";

export interface UserTokenMintDeps {
  /** Where the minting organization's embedding settings are read. */
  readonly store: Pick<Store, "getResource">;
  readonly authorizer: Authorizer;
  /** The any-mode subject lookup: an existing person is found whatever wrote it. */
  readonly accounts: Pick<IdentityAccountStore, "findByIdpId">;
  /** The identity-account domain's one create path (identityaccount/controller.ts). */
  readonly createAccount: CreateAccount;
  readonly grantPath: Pick<IamPolicyGrantPath, "grant">;
  /** The composed ring; undefined when the server trusts every request. */
  readonly keys: PlatformTokenKeyRing | undefined;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** The person a mint request names, as the account and the token carry them. */
interface AppUser {
  readonly externalUserId: string;
  readonly email: string;
  readonly name: string;
}

export async function mintUserToken(
  deps: UserTokenMintDeps,
  request: MintUserTokenRequest,
  caller: CallerIdentity,
): Promise<MintUserTokenResponse> {
  const keys = deps.keys;
  if (keys === undefined) {
    throw new ConnectError(
      MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
      Code.FailedPrecondition,
    );
  }
  if (!canSign(keys)) {
    throw new ConnectError(MINTING_DISABLED_MESSAGE, Code.FailedPrecondition);
  }

  const minter = mintingAccountOf(caller);
  await authorizeDirect(
    TokenService.method.mintUserToken,
    deps.authorizer,
    caller,
    request,
  );
  const embedding = await embeddingOf(deps, minter.org);
  const tokenOrg = request.org;

  const user: AppUser = {
    externalUserId: request.userId,
    email: request.userEmail,
    name: request.userName,
  };
  const accountId = await resolveOrProvisionAccount(
    deps,
    minter.id,
    embedding,
    tokenOrg,
    user,
  );

  const signed = signPlatformToken(
    keys,
    {
      [USER_TOKEN_CLAIMS.subject]: accountId,
      [USER_TOKEN_CLAIMS.externalUserId]: user.externalUserId,
      [USER_TOKEN_CLAIMS.email]: user.email,
      [USER_TOKEN_CLAIMS.name]: user.name,
      [USER_TOKEN_CLAIMS.org]: tokenOrg,
      [USER_TOKEN_CLAIMS.mintedBy]: minter.id,
    },
    { now: deps.now() },
  );
  return create(MintUserTokenResponseSchema, {
    accessToken: signed.token,
    tokenType: BEARER_TOKEN_TYPE,
    expiresIn: keys.ttlSeconds,
  });
}

/**
 * The minting service account and its organization, or PERMISSION_DENIED
 * for any other caller. A service account's key is always bound to its
 * organization (domain/apikey/verifier.ts); one that is not is refused
 * rather than guessed at.
 */
function mintingAccountOf(caller: CallerIdentity): {
  readonly id: string;
  readonly org: string;
} {
  const org = boundOrgOf(caller);
  if (!isServiceAccountCaller(caller) || org === undefined) {
    throw new ConnectError(
      MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
      Code.PermissionDenied,
    );
  }
  return { id: caller.identityId, org };
}

/** The minting organization's embedding settings; none set reads as every setting off. */
async function embeddingOf(
  deps: UserTokenMintDeps,
  org: string,
): Promise<OrganizationEmbedding | undefined> {
  try {
    const organization = await deps.store.getResource(
      ApiResourceKind.organization,
      org,
      OrganizationSchema,
    );
    return organization.spec?.embedding;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      // The key's organization was deleted after its key was verified.
      throw new ConnectError(
        MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE,
        Code.PermissionDenied,
      );
    }
    throw internalError(error, "failed to read the organization's embedding settings");
  }
}

/** The account id for the person: the existing app-user account, or one created now. */
async function resolveOrProvisionAccount(
  deps: UserTokenMintDeps,
  minterId: string,
  embedding: OrganizationEmbedding | undefined,
  org: string,
  user: AppUser,
): Promise<string> {
  const idpId = appUserSubject(org, user.externalUserId);
  const existing = await findAccount(deps, idpId);
  if (existing !== undefined) {
    return appUserAccountId(existing, user, org);
  }

  if (embedding?.createAccountsOnSignIn !== true) {
    throw new ConnectError(
      noAccountMessage(user.externalUserId, org),
      Code.FailedPrecondition,
    );
  }
  const input = accountInput(idpId, org, user);
  const actor = serverActingFor(minterId);

  if (embedding.signInRole !== IamRole.iam_role_unspecified) {
    await grantSignInRole(
      deps,
      embedding.signInRole,
      org,
      accountIdFor(idpId),
      actor,
    );
  }

  try {
    const created = await deps.createAccount(input, actor);
    return created.metadata?.id ?? "";
  } catch (error) {
    const winner = await resolveCreateRace(error, () =>
      deps.accounts.findByIdpId(idpId),
    );
    return appUserAccountId(winner, user, org);
  }
}

/** The account under the subject in any mode; a store fault is INTERNAL, never "no account". */
async function findAccount(
  deps: UserTokenMintDeps,
  idpId: string,
): Promise<IdentityAccount | undefined> {
  try {
    return await deps.accounts.findByIdpId(idpId);
  } catch (error) {
    throw internalError(error, "failed to resolve the app user");
  }
}

/**
 * The account's id, when a mint created it: a row under a `stgm_pc|`
 * subject in any other mode is refused rather than minted for.
 */
function appUserAccountId(
  account: IdentityAccount,
  user: AppUser,
  org: string,
): string {
  if (
    account.spec?.provisioningMode !== IdentityAccountProvisioningMode.app_user
  ) {
    throw new ConnectError(
      foreignAccountMessage(user.externalUserId, org),
      Code.FailedPrecondition,
    );
  }
  return account.metadata?.id ?? "";
}

/**
 * The account the create path will write, validated now so no grant is
 * written for a person the create path would refuse: named by the email,
 * else the external id; first and last name split from the display name at
 * its first space, else the email's local part.
 */
function accountInput(
  idpId: string,
  org: string,
  user: AppUser,
): CreateAccountInput {
  const input: CreateAccountInput = {
    // Cut to metadata.name's bound: the name is the mint's choice.
    name: fittedName(user.email !== "" ? user.email : user.externalUserId),
    spec: create(IdentityAccountSpecSchema, {
      idpId,
      email: user.email,
      ...splitName(user.name, user.email),
    }),
    provisioning: { mode: "app_user", org },
  };
  const result = validator().validate(
    IdentityAccountSchema,
    create(IdentityAccountSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { name: input.name, org },
      spec: input.spec,
    }),
  );
  if (result.kind === "invalid") {
    throw new ConnectError(result.error.message, Code.InvalidArgument);
  }
  if (result.kind === "error") {
    throw new ConnectError(
      `validation could not run: ${result.error.message}`,
      Code.Internal,
    );
  }
  return input;
}

/**
 * Grants the embedding sign-in role on the token's organization to the
 * derived account id, as the minting service account. Owner is refused
 * here too: the contract refuses it on every write, and stored settings
 * must still never make an app user an owner. A role the organization does
 * not grant is refused with updateEmbedding's copy: its grant could only
 * fail.
 */
async function grantSignInRole(
  deps: UserTokenMintDeps,
  role: IamRole,
  org: string,
  accountId: string,
  actor: CallerIdentity,
): Promise<void> {
  if (role === IamRole.owner) {
    throw new ConnectError(OWNER_SIGN_IN_ROLE_MESSAGE, Code.InvalidArgument);
  }
  if (!isGrantableSignInRole(role)) {
    throw new ConnectError(
      signInRoleNotGrantableMessage(role),
      Code.InvalidArgument,
    );
  }
  try {
    await deps.grantPath.grant(organizationRole(accountId, role, org), actor, "grant");
  } catch (error) {
    deps.logger.error(
      "app user sign-in role grant failed; nothing was provisioned",
      {
        accountId,
        mintedBy: actor.identityId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw new ConnectError(PROVISIONING_FAILED_MESSAGE, Code.Internal);
  }
}

/** `stgm_pc|<org>|<user_id>`, each part non-blank and free of the separator. */
export function appUserSubject(org: string, externalUserId: string): string {
  requireSubjectPart("org", org);
  requireSubjectPart("externalUserId", externalUserId);
  return `${APP_USER_SUBJECT_PREFIX}${org}${SUBJECT_SEPARATOR}${externalUserId}`;
}

function requireSubjectPart(
  part: "org" | "externalUserId",
  value: string,
): void {
  if (value.trim() === "") {
    throw new ConnectError(blankSubjectPartMessage(part), Code.InvalidArgument);
  }
  if (value.includes(SUBJECT_SEPARATOR)) {
    throw new ConnectError(
      subjectSeparatorMessage(part, value),
      Code.InvalidArgument,
    );
  }
}

/** The name split: the display name at its first space, else the email's local part. */
function splitName(
  name: string,
  email: string,
): { firstName: string; lastName: string } {
  if (name !== "") {
    const space = name.indexOf(" ");
    return space > 0
      ? { firstName: name.slice(0, space), lastName: name.slice(space + 1) }
      : { firstName: name, lastName: "" };
  }
  const at = email.indexOf("@");
  return { firstName: at >= 0 ? email.slice(0, at) : email, lastName: "" };
}
