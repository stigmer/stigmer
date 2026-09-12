/**
 * Direct-account self-provisioning (20260911.11, Q-IA-2; the cloud's
 * iam/account/provisioning.ts steps 1 to 3 as OSS core): the console, the
 * CLI and the React hook call provisionMyAccount when whoAmI answers
 * NOT_FOUND on a first sign-in, and the caller's OWN authenticated request
 * drives provisioning synchronously — no webhook, no external trigger.
 *
 * The flow:
 *   1. Idempotent early return when the subject already has an account
 *      (a primary-key read of the derived id; no userinfo call).
 *   2. The profile. A token-bearing caller's comes from the userinfo
 *      endpoint of the issuer that vouched for the token, fetched with the
 *      caller's own access token — the token goes only where it came from
 *      (T01_1_review.md A8). One path for every issuer: `given_name` and
 *      `family_name` as the IdP states them, where splitting a `name`
 *      claim would be guesswork. A caller with no issuer (the trusted-local
 *      operator) never dials out: its profile is what the CallerIdentity
 *      carries.
 *   3. Create through the ONE create path the domain owns — the same chain
 *      the create RPC runs, so the tuple lifecycle fires for both — AS the
 *      caller: the account is created by the subject it is for, and its
 *      audit stamp says so. A lost first-login race resolves the winner by
 *      subject whatever the failure's shape (the cloud's idempotency arm):
 *      the primary key guarantees one row, so a failed create with a row
 *      underneath it is a win, not an error.
 *
 * Step 4 of the cloud's flow (the personal organization) is not core: it
 * fires on the `identity-account-provision:post-persist` slot in the
 * composition (A10), wired by the controller.
 *
 * This module holds the domain flow over two PORTS — the store and the
 * userinfo client — and no network code; identity/oidc-userinfo.ts is the
 * OIDC implementation the composition root wires in.
 */
import { create } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountSpec } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { assignDirectBackendFields } from "./steps.js";
import type { IdentityAccountStore } from "./store.js";

/** The profile an identity provider's userinfo endpoint states. */
export interface UserProfile {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly pictureUrl: string;
}

/** The userinfo port: `issuer` is the one that vouched for `accessToken`. */
export interface UserInfoClient {
  /** Throws on any failure to obtain a profile (the handler maps UNAVAILABLE). */
  fetchUserProfile(issuer: string, accessToken: string): Promise<UserProfile>;
}

/** Thrown when the profile cannot be fetched; the handler answers UNAVAILABLE. */
export class UserInfoFetchError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "UserInfoFetchError";
  }
}

/** What a caller of the create path supplies: the rest is the chain's. */
export interface CreateAccountInput {
  /** `metadata.name`; the chain defaults an empty one. */
  readonly name: string;
  readonly spec: IdentityAccountSpec;
}

/**
 * The domain's one create path, as its callers see it: runs the create
 * chain AS `caller` and answers the persisted account. Built by the
 * controller (newCreateAccountPath); the provisioner and the operator
 * ensure call it, nothing else builds an account.
 */
export type CreateAccount = (
  input: CreateAccountInput,
  caller: CallerIdentity,
) => Promise<IdentityAccount>;

export interface DirectAccountProvisionerDeps {
  readonly accounts: IdentityAccountStore;
  readonly createAccount: CreateAccount;
  readonly userInfo: UserInfoClient;
}

export interface DirectAccountProvisioner {
  /** provisionMyAccount's domain flow; `idpId` is the caller's verified subject. */
  provisionDirectAccount(
    idpId: string,
    caller: CallerIdentity,
  ): Promise<IdentityAccount>;
}

export function newDirectAccountProvisioner(
  deps: DirectAccountProvisionerDeps,
): DirectAccountProvisioner {
  return {
    async provisionDirectAccount(idpId, caller): Promise<IdentityAccount> {
      const existing = await deps.accounts.findDirectByIdpId(idpId);
      if (existing !== undefined) {
        return existing;
      }

      const profile = await profileOf(deps.userInfo, caller);
      const input: CreateAccountInput = {
        name: displayNameOf(caller, profile),
        spec: assignDirectBackendFields(
          create(IdentityAccountSpecSchema, {
            idpId,
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            pictureUrl: profile.pictureUrl,
          }),
        ),
      };

      try {
        return await deps.createAccount(input, caller);
      } catch (error) {
        return resolveCreateRace(error, () =>
          deps.accounts.findDirectByIdpId(idpId),
        );
      }
    },
  };
}

/** Userinfo for a token-bearing caller; the identity's own claims otherwise. */
async function profileOf(
  userInfo: UserInfoClient,
  caller: CallerIdentity,
): Promise<UserProfile> {
  if (caller.issuer === "") {
    return {
      email: caller.email ?? "",
      firstName: "",
      lastName: "",
      pictureUrl: "",
    };
  }
  try {
    return await userInfo.fetchUserProfile(caller.issuer, caller.rawToken);
  } catch (error) {
    throw new UserInfoFetchError(error);
  }
}

/**
 * The cloud names a provisioned account by its email; the trusted-local
 * operator, who has no userinfo, by the display name the identity
 * carries. An empty result is the chain's to default (DefaultAccountName).
 */
function displayNameOf(caller: CallerIdentity, profile: UserProfile): string {
  if (caller.issuer === "") {
    return caller.displayName ?? profile.email;
  }
  return profile.email;
}

/**
 * The concurrent-create resolution every lane uses: on a failed create,
 * read the winner back by the lane's natural key; a winner is the answer,
 * whatever the failure's shape (the chain's ALREADY_EXISTS, a driver's
 * DuplicateAccountError, a transport fault after the row landed). No
 * winner means the failure was real — it propagates untouched.
 */
export async function resolveCreateRace(
  error: unknown,
  findWinner: () => Promise<IdentityAccount | undefined>,
): Promise<IdentityAccount> {
  const winner = await findWinner();
  if (winner === undefined) {
    throw error;
  }
  return winner;
}
