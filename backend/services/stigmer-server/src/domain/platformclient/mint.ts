/**
 * The PlatformClient mint: `mintUserToken`, the public RPC a platform's
 * backend calls with its client_id + client_secret and one of its users,
 * answered with a short-lived Stigmer user token for that user.
 *
 * The contract is the cloud's, refusal for refusal and in the same order
 * (constants.ts carries the copy): the credentials, then the secret's
 * expiry (unset means never), then the `org_id` confirmation (a token is
 * always scoped to the client's owning organization), then the user.
 *
 * The user is keyed `stgm_pc|<org>|<user_id>`, so every client of one
 * organization resolves one user to one account, and that account's id is
 * derived from the subject (identityaccount/constants.ts accountIdFor). An
 * account that exists is used as it is — its roles and profile stay what
 * they are, whatever the client's settings say now — and must have been
 * provisioned by a platform client: the subject namespace is reserved in
 * both directions. An account that does not exist is provisioned when the
 * client allows it, in this order:
 *
 *   1. The account's input is built and validated, so nothing below runs
 *      for a user the create chain would refuse.
 *   2. When the client auto-grants, the role (viewer by default; never
 *      owner) is granted on the owning organization to the DERIVED account
 *      id, before the account row exists. The grant path is idempotent.
 *   3. The account is created through the identity-account domain's one
 *      create path, in `platform_client` mode. A concurrent first mint that
 *      won the race is read back.
 *
 * Granting first is what makes every failure retry-safe with nothing to
 * undo: a failed grant has written nothing; a failed create leaves one
 * policy row naming an account that does not exist yet, which the next
 * mint for that user completes. Creating first would need a rollback, and
 * a rollback that fails leaves an account that can never receive its role
 * (the existing-account arm never grants).
 *
 * Who acts: the request is public and tokenless, so the chain stamped the
 * trusted-local operator on it — this module never reads that caller. The
 * account and the policy are written as the CLIENT (`serverActingFor`, an
 * `internal` caller naming the client's id), so the audit says which
 * platform client brought the user in. End users are not people on the
 * install: the membership rules never run for them (the create path is
 * called directly, and identity-account provisioning's hook is not), and
 * the boot reconciliation skips their mode (iampolicy/membership.ts).
 *
 * The email and name in the token and on the account are the platform's
 * assertion; nothing on the server derives authority from either.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type {
  MintUserTokenRequest,
  MintUserTokenResponse,
} from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { MintUserTokenResponseSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../../pipeline/errors.js";
import { serverActingFor } from "../../pipeline/interceptors/auth.js";
import { validator } from "../../pipeline/steps/validation.js";
import {
  canSign,
  type PlatformTokenKeyRing,
} from "../../platformtoken/key-ring.js";
import { signPlatformToken } from "../../platformtoken/envelope.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { organizationRole } from "../iampolicy/specs.js";
import {
  PLATFORM_CLIENT_SUBJECT_PREFIX,
  accountIdFor,
} from "../identityaccount/constants.js";
import type {
  CreateAccount,
  CreateAccountInput,
} from "../identityaccount/provisioning.js";
import { resolveCreateRace } from "../identityaccount/provisioning.js";
import type { IdentityAccountStore } from "../identityaccount/store.js";
import {
  BEARER_TOKEN_TYPE,
  EXPIRED_CLIENT_SECRET_MESSAGE,
  INVALID_CLIENT_CREDENTIALS_MESSAGE,
  MINTING_DISABLED_MESSAGE,
  MINTING_REQUIRES_AUTHENTICATION_MESSAGE,
  OWNER_AUTO_GRANT_MESSAGE,
  PROVISIONING_FAILED_MESSAGE,
  USER_TOKEN_CLAIMS,
  blankSubjectPartMessage,
  foreignAccountMessage,
  noAccountMessage,
  organizationMismatchMessage,
  subjectSeparatorMessage,
} from "./constants.js";
import { secretMatchesHash } from "./credentials.js";
import type { PlatformClientStore } from "./store.js";

/** The separator of the composite subject; neither part may contain it. */
const SUBJECT_SEPARATOR = "|";

/** The role an auto-grant gives when the client leaves it unspecified (the proto's default). */
const DEFAULT_AUTO_GRANT_ROLE = IamRole.viewer;

export interface PlatformClientMintDeps {
  readonly clients: PlatformClientStore;
  /** The any-mode subject lookup: an existing end user is found whatever wrote it. */
  readonly accounts: Pick<IdentityAccountStore, "findByIdpId">;
  /** The identity-account domain's one create path (identityaccount/controller.ts). */
  readonly createAccount: CreateAccount;
  readonly grantPath: Pick<IamPolicyGrantPath, "grant">;
  /** The composed ring; undefined when the server trusts every request. */
  readonly keys: PlatformTokenKeyRing | undefined;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** The end user a mint request names, as the account and the token carry them. */
interface EndUser {
  readonly externalUserId: string;
  readonly email: string;
  readonly name: string;
}

export async function mintUserToken(
  deps: PlatformClientMintDeps,
  request: MintUserTokenRequest,
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

  const client = await authenticateClient(deps, request);
  const owningOrg = client.metadata?.org ?? "";
  // A confirmation, never a selector: a token is scoped to the owning org.
  if (request.orgId !== "" && request.orgId !== owningOrg) {
    throw new ConnectError(
      organizationMismatchMessage(owningOrg),
      Code.InvalidArgument,
    );
  }

  const user: EndUser = {
    externalUserId: request.userId,
    email: request.userEmail,
    name: request.userName,
  };
  const accountId = await resolveOrProvisionAccount(
    deps,
    client,
    owningOrg,
    user,
  );

  const signed = signPlatformToken(
    keys,
    {
      [USER_TOKEN_CLAIMS.subject]: accountId,
      [USER_TOKEN_CLAIMS.externalUserId]: user.externalUserId,
      [USER_TOKEN_CLAIMS.email]: user.email,
      [USER_TOKEN_CLAIMS.name]: user.name,
      [USER_TOKEN_CLAIMS.org]: owningOrg,
      [USER_TOKEN_CLAIMS.platformClientId]: client.metadata?.id ?? "",
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
 * The client the credentials name, or UNAUTHENTICATED with one copy for an
 * unknown client_id and a wrong secret alike; then the secret's expiry.
 */
async function authenticateClient(
  deps: PlatformClientMintDeps,
  request: MintUserTokenRequest,
): Promise<PlatformClient> {
  let client: PlatformClient | undefined;
  try {
    client = await deps.clients.findByClientId(request.clientId);
  } catch (error) {
    throw internalError(error, "failed to authenticate platform client");
  }
  if (
    client === undefined ||
    !secretMatchesHash(
      request.clientSecret,
      client.spec?.clientSecretHash ?? "",
    )
  ) {
    throw new ConnectError(
      INVALID_CLIENT_CREDENTIALS_MESSAGE,
      Code.Unauthenticated,
    );
  }
  const spec = client.spec;
  if (
    spec?.neverExpires !== true &&
    spec?.expiresAt !== undefined &&
    deps.now().getTime() > timestampDate(spec.expiresAt).getTime()
  ) {
    throw new ConnectError(
      EXPIRED_CLIENT_SECRET_MESSAGE,
      Code.FailedPrecondition,
    );
  }
  return client;
}

/** The account id for the user: the existing platform-client account, or one provisioned now. */
async function resolveOrProvisionAccount(
  deps: PlatformClientMintDeps,
  client: PlatformClient,
  org: string,
  user: EndUser,
): Promise<string> {
  const idpId = platformClientSubject(org, user.externalUserId);
  const existing = await findAccount(deps, idpId);
  if (existing !== undefined) {
    return platformClientAccountId(existing, user, org);
  }

  const spec = client.spec;
  if (spec?.autoProvisionAccounts !== true) {
    throw new ConnectError(
      noAccountMessage(user.externalUserId, org),
      Code.FailedPrecondition,
    );
  }
  const input = accountInput(idpId, org, user);
  const actor = serverActingFor(client.metadata?.id ?? "");

  if (spec.autoGrantOnOrg) {
    await grantAutoRole(deps, client, org, accountIdFor(idpId), actor);
  }

  try {
    const created = await deps.createAccount(input, actor);
    return created.metadata?.id ?? "";
  } catch (error) {
    const winner = await resolveCreateRace(error, () =>
      deps.accounts.findByIdpId(idpId),
    );
    return platformClientAccountId(winner, user, org);
  }
}

/** The account under the subject, any mode; a store fault is INTERNAL, never "no account". */
async function findAccount(
  deps: PlatformClientMintDeps,
  idpId: string,
): Promise<IdentityAccount | undefined> {
  try {
    return await deps.accounts.findByIdpId(idpId);
  } catch (error) {
    throw internalError(error, "failed to resolve platform client user");
  }
}

/**
 * The account's id, when a platform client provisioned it: a row under a
 * `stgm_pc|` subject in any other mode is refused rather than minted for.
 */
function platformClientAccountId(
  account: IdentityAccount,
  user: EndUser,
  org: string,
): string {
  if (
    account.spec?.provisioningMode !==
    IdentityAccountProvisioningMode.platform_client
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
 * written for a user the chain would refuse. The cloud's shape: named by
 * the email, else the external id; first and last name split from the
 * display name at its first space, else the email's local part.
 */
function accountInput(
  idpId: string,
  org: string,
  user: EndUser,
): CreateAccountInput {
  const input: CreateAccountInput = {
    name: user.email !== "" ? user.email : user.externalUserId,
    spec: create(IdentityAccountSpecSchema, {
      idpId,
      email: user.email,
      ...splitName(user.name, user.email),
    }),
    provisioning: { mode: "platform_client", org },
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
 * Grants the client's auto-grant role on the owning organization to the
 * derived account id, as the client. Owner is refused here too: the
 * contract refuses it on every write since this release, and a row stored
 * before that must still never make an end user an owner.
 */
async function grantAutoRole(
  deps: PlatformClientMintDeps,
  client: PlatformClient,
  org: string,
  accountId: string,
  actor: CallerIdentity,
): Promise<void> {
  const configured = client.spec?.autoGrantRole ?? IamRole.iam_role_unspecified;
  if (configured === IamRole.owner) {
    throw new ConnectError(OWNER_AUTO_GRANT_MESSAGE, Code.InvalidArgument);
  }
  const role =
    configured === IamRole.iam_role_unspecified
      ? DEFAULT_AUTO_GRANT_ROLE
      : configured;
  try {
    await deps.grantPath.grant(organizationRole(accountId, role, org), actor);
  } catch (error) {
    deps.logger.error(
      "platform client auto-grant failed; nothing was provisioned",
      {
        accountId,
        platformClientId: client.metadata?.id ?? "",
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw new ConnectError(PROVISIONING_FAILED_MESSAGE, Code.Internal);
  }
}

/** `stgm_pc|<org>|<user_id>`, each part non-blank and free of the separator. */
export function platformClientSubject(
  org: string,
  externalUserId: string,
): string {
  requireSubjectPart("org", org);
  requireSubjectPart("externalUserId", externalUserId);
  return `${PLATFORM_CLIENT_SUBJECT_PREFIX}${org}${SUBJECT_SEPARATOR}${externalUserId}`;
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

/** The cloud's name split: the display name at its first space, else the email's local part. */
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
