// User-token fixtures for the conformance suites: a minting service
// account and its key, an organization's embedding settings, and the mint.
// Domain: conformance support.
//
// A product signs its people in by minting their tokens with a service
// account's API key, so these helpers take the clients to act through
// instead of reaching for an environment: the suites pass their enforcing
// lane's founder (the cloud's primary; open source's sibling in the OIDC
// posture, the only posture in which a server mints tokens) to create the
// account and set the settings, and the key's own clients to mint. The
// founder owns every organization the lane provisions, and an
// organization's owner is its admin.
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { ConformanceClients } from "../harness/clients";
import { plaintextKeyOf } from "./apikeys";

export interface Minter {
  // The service account's id: the minted token's minted_by claim and the
  // audit actor's minted_by.
  readonly accountId: string;
  // The plaintext of its key: the bearer the mint is called with.
  readonly key: string;
}

export interface MinterOptions {
  readonly org: string;
  readonly name: string;
  // The account's organization role; admin, unless an arm proves a lesser
  // role is refused.
  readonly role?: IamRole;
}

// Creates a service account in the organization through `clients` and a
// never-expiring key for it.
export async function createMinter(
  clients: ConformanceClients,
  options: MinterOptions,
): Promise<Minter> {
  const account = await clients.identityAccountCommand.createServiceAccount({
    org: options.org,
    name: options.name,
    role: options.role ?? IamRole.admin,
  });
  const accountId = account.metadata?.id ?? "";
  const key = plaintextKeyOf(
    await clients.apiKeyCommand.createForServiceAccount({
      serviceAccountId: accountId,
      name: `${options.name}-key`,
      neverExpires: true,
    }),
  );
  if (accountId === "" || key === "") {
    throw new Error(`service account ${options.name} returned no id or key`);
  }
  return { accountId, key };
}

export async function deleteMinter(
  clients: ConformanceClients,
  accountId: string,
): Promise<void> {
  await clients.identityAccountCommand.delete({ value: accountId });
}

export interface EmbeddingOptions {
  // The browser-context allowlist the origin arm enforces; omitted = open.
  readonly allowedOrigins?: readonly string[];
  // The arms mint fresh user_ids that must not pre-exist, so a first
  // sign-in creates the account unless an arm says otherwise.
  readonly createAccountsOnSignIn?: boolean;
  readonly signInRole?: IamRole;
}

// Replaces the organization's embedding settings through `clients`.
export async function setEmbedding(
  clients: ConformanceClients,
  org: string,
  options: EmbeddingOptions = {},
): Promise<void> {
  await clients.organizationCommand.updateEmbedding({
    orgId: org,
    embedding: {
      createAccountsOnSignIn: options.createAccountsOnSignIn ?? true,
      ...(options.signInRole !== undefined ? { signInRole: options.signInRole } : {}),
      allowedOrigins: [...(options.allowedOrigins ?? [])],
    },
  });
}

// Mints a user token for `userId` in `org`, called with the minter's key
// through `asMinter` (clients presenting that key).
export async function mintUserToken(
  asMinter: ConformanceClients,
  org: string,
  userId: string,
  extra: { userEmail?: string; userName?: string } = {},
): Promise<string> {
  const minted = await asMinter.token.mintUserToken({ org, userId, ...extra });
  if (minted.accessToken === "" || minted.tokenType !== "Bearer") {
    throw new Error(`mintUserToken for ${userId} returned no Bearer token`);
  }
  return minted.accessToken;
}
