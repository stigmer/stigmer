/**
 * The IdentityFederation capability: the four federated-account arms of
 * open source's identity-account controller, behind the
 * `drivers.identityFederation` point. The controller keeps what holds in
 * every edition: the annotation's authorize on the
 * organization, the reference's resolution to its provider's id (by slug
 * through the name table, @stigmer/server's reference resolver), the
 * org-match check, and the IdP-exists
 * refusal — which the controller asks of `providerExists` here, for every
 * arm. A provider whose delete has begun still exists for that question,
 * so its admins can still deprovision, update and look up its accounts
 * while the delete has not finished; only create refuses it, with the
 * provider lane's own copy, so no account is made under a provider on its
 * way out (provider/removal.ts). Create checks before it writes, and a
 * delete can still begin while it writes, after the delete's first sweep
 * listed the accounts. So create reads the provider
 * again once it has written, the federated verifier's own rule: on a
 * provider gone, marked, or unreadable, it removes the account it made and
 * refuses (the read's own fault when the read failed). A removal that
 * fails is logged by the account's id, and the create is refused all the
 * same; the provider's removal sweeps its accounts once more after its row
 * is gone, so only a write after that sweep whose removal also failed is
 * left, and its id is in the log. Each arm
 * receives the RESOLVED ref (org filled from the input where the ref left
 * it empty, the provider's id set) and owns only what differs per
 * edition: the natural-key
 * lookups and writes on the federated rows, over the unit's own store,
 * since the port carries direct-account methods only.
 *
 * The postures each arm keeps, with byte-pinned copy, because clients
 * match on it:
 *   - create refuses ALREADY_EXISTS naming the existing id when the
 *     (provider ref, external sub) key is held, and resolves a lost insert
 *     race to the winner by that key;
 *   - update writes the four profile fields and nothing else — the
 *     identity keys (idp_id, provider ref, provisioning mode) stay as the
 *     row has them;
 *   - deprovision revokes the account's org access FIRST and deletes the
 *     row only when asked, so a failed delete leaves no access behind. The
 *     revoke reaches the provider's organization and every child of that
 *     organization, whatever the provider's `external_id_claim` says now,
 *     because a sign-in it routed may have granted roles in any of them,
 *     and the claim can be cleared afterwards: offboarding a person without
 *     deleting them must not leave a child organization's role behind. A
 *     child whose delete is pending cannot be reached: every request that
 *     names it answers not found until the delete is accepted (its purge
 *     then removes every role) or refused (the child lives on, the role
 *     with it). So the deprovision reads the children mid-delete on both
 *     sides of the live list, tries every one, and when it keeps the
 *     account and a child answered not found, answers ABORTED naming it;
 *     the retry is idempotent and completes once the window has passed. A
 *     child missed by all three reads would need its whole delete, mark
 *     to refusal, to fall between two consecutive reads. One that deletes the account goes through: the account's
 *     removal deletes its policies by account, naming no organization;
 *   - a missing federated account is NOT_FOUND with the pinned copy.
 *
 * The caller each arm receives is unused today; the capability's
 * signature carries it for an arm that must attribute a write.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import type { ChildOrganizations, IdentityFederation, Logger } from "@stigmer/server";
import { abortedError, failedPreconditionError } from "@stigmer/server";

import type { IdentityAccountService } from "./account/port.js";
import { resolveCreateRace } from "./account/port.js";
import type { IamPolicyGrantPathClient } from "./policy/grant-path-client.js";
import { PROVIDER_BEING_DELETED_MESSAGE } from "./provider/steps.js";
import type { IdentityProviderStore } from "./provider/store.js";

export interface CloudIdentityFederationDeps {
  readonly accounts: IdentityAccountService;
  readonly policies: IamPolicyGrantPathClient;
  /** The IdentityProvider rows — the controller's IdP-exists precondition, create's delete check and deprovision's provider read them. */
  readonly providers: Pick<IdentityProviderStore, "findById" | "isLive">;
  /**
   * The provider organization's children, which deprovision's revoke
   * reaches, and those mid-delete, which it cannot reach yet.
   */
  readonly childOrganizations: Pick<ChildOrganizations, "listIds" | "listIdsBeingDeleted">;
  readonly logger: Logger;
}

export function newIdentityFederation(
  deps: CloudIdentityFederationDeps,
): IdentityFederation {
  const { accounts, policies, providers, childOrganizations, logger } = deps;
  /** The provider a resolved reference holds, by its id, in the organization it names. */
  const providerOf = async (org: string, id: string) => {
    if (id === "") {
      return undefined;
    }
    const provider = await providers.findById(id);
    return provider !== undefined && (provider.metadata?.org ?? "") === org ? provider : undefined;
  };

  /**
   * The provider as copy names it, `org/slug`: the reference holds the
   * provider's id, and a person reads its name (its id when it is gone, or
   * when the read faults, so a byte-pinned refusal never turns into the
   * read's fault).
   */
  async function idpName(ref: ApiResourceReference): Promise<string> {
    const provider = await providerOf(ref.org, ref.id).catch(() => undefined);
    return `${ref.org}/${provider?.metadata?.slug || ref.id}`;
  }

  /**
   * After create wrote: whether the provider it checked is still there and
   * live, by the id the reference holds. A provider that is gone is not. A
   * fault propagates, after the caller's undo.
   */
  async function stillLive(ref: ApiResourceReference, checkedId: string | undefined): Promise<boolean> {
    const now = await providerOf(ref.org, ref.id);
    const id = now?.metadata?.id;
    return id !== undefined && (checkedId === undefined || id === checkedId) && (await providers.isLive(id));
  }

  /** Removes an account create made under a provider on its way out; a failure is logged, never thrown. */
  async function removeMade(
    account: IdentityAccount,
    ref: ApiResourceReference,
    providerId: string | undefined,
  ): Promise<void> {
    try {
      await accounts.deleteAccount(account, providerId);
    } catch (error) {
      logger.error("an account created under an identity provider being deleted could not be removed", {
        accountId: account.metadata?.id ?? "",
        idp: await idpName(ref),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async createFederatedAccount(input, ref): Promise<IdentityAccount> {
      // Stops every create that starts after the mark; the read after the
      // write below catches one already past it (the module header).
      const provider = await providerOf(ref.org, ref.id);
      if (provider !== undefined && !(await providers.isLive(provider.metadata?.id ?? ""))) {
        throw failedPreconditionError(PROVIDER_BEING_DELETED_MESSAGE);
      }
      const existing = await accounts.store.findByProviderAndIdpId(
        ref.id,
        input.externalSub,
      );
      if (existing !== undefined) {
        throw new ConnectError(
          "Federated account already exists for this identity provider " +
            `and external subject (existing id: ${existing.metadata?.id ?? ""})`,
          Code.AlreadyExists,
        );
      }
      let account: IdentityAccount;
      let made = true;
      try {
        account = await accounts.createAccount({
          org: ref.org,
          name: input.email,
          spec: create(IdentityAccountSpecSchema, {
            idpId: input.externalSub,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            pictureUrl: input.pictureUrl,
            provisioningMode: IdentityAccountProvisioningMode.federated,
            identityProviderRef: ref,
          }),
        }, provider?.metadata?.id);
      } catch (error) {
        made = false;
        account = await resolveCreateRace(error, () =>
          accounts.store.findByProviderAndIdpId(ref.id, input.externalSub),
        );
      }
      const providerId = provider?.metadata?.id;
      let live: boolean;
      try {
        live = await stillLive(ref, providerId);
      } catch (error) {
        if (made) {
          await removeMade(account, ref, providerId);
        }
        throw error;
      }
      if (!live) {
        // An account a racing create made is its writer's to remove; that
        // create reads the provider after it writes too.
        if (made) {
          await removeMade(account, ref, providerId);
        }
        throw failedPreconditionError(PROVIDER_BEING_DELETED_MESSAGE);
      }
      return account;
    },

    async updateFederatedAccount(input, ref): Promise<IdentityAccount> {
      const existing = await requireFederatedAccount(
        accounts,
        ref,
        input.externalSub,
        () => idpName(ref),
      );
      const spec = existing.spec;
      if (spec !== undefined) {
        spec.email = input.email;
        spec.firstName = input.firstName;
        spec.lastName = input.lastName;
        spec.pictureUrl = input.pictureUrl;
      }
      return accounts.updateAccount(existing);
    },

    async deprovisionFederatedAccount(input, ref): Promise<IdentityAccount> {
      const existing = await requireFederatedAccount(
        accounts,
        ref,
        input.externalSub,
        () => idpName(ref),
      );
      const accountId = existing.metadata?.id ?? "";
      // The removal follows the provider's word, so it is made acting for
      // the provider: its rows and the permission history name it. It
      // reaches the organization and every child of the provider's
      // organization, whatever the provider's external_id_claim says now:
      // the claim can be cleared after it routed the person into a child,
      // and offboarding must leave nothing behind there.
      const provider = await providerOf(ref.org, ref.id);
      const actingFor = provider?.metadata?.id;
      await policies.bootstrapRevokeOrgAccess(accountId, input.org, actingFor);
      // The children to reach: the live ones, and the ones mid-delete read
      // on both sides of that list, so a child marked as the live list is
      // read and refused just after is still in one of the two reads. Each
      // is then revoked directly: one whose delete is pending when the
      // revoke reaches it answers not found, and is the caller's to retry.
      const pendingBefore = await childOrganizations.listIdsBeingDeleted(ref.org);
      const live = await childOrganizations.listIds(ref.org);
      const pendingAfter = await childOrganizations.listIdsBeingDeleted(ref.org);
      const unreachable: string[] = [];
      for (const child of new Set([...live, ...pendingBefore, ...pendingAfter])) {
        try {
          await policies.bootstrapRevokeOrgAccess(accountId, child, actingFor);
        } catch (error) {
          if (ConnectError.from(error).code !== Code.NotFound) {
            throw error;
          }
          unreachable.push(child);
        }
      }
      if (input.deleteAccount) {
        await accounts.deleteAccount(existing, actingFor);
        return existing;
      }
      if (unreachable.length > 0) {
        throw abortedError(midDeleteMessage(ref.org, unreachable));
      }
      return existing;
    },

    getByExternalSub(lookup, ref): Promise<IdentityAccount> {
      return requireFederatedAccount(accounts, ref, lookup.externalSub, () => idpName(ref));
    },

    async providerExists(org, id): Promise<boolean> {
      return (await providerOf(org, id)) !== undefined;
    },
  };
}

/** The deprovision's answer while a child of the provider's organization is mid-delete. */
function midDeleteMessage(org: string, children: ReadonlyArray<string>): string {
  const named = children.map((child) => `'${child}'`).join(", ");
  const one = children.length === 1;
  return (
    `Offboarding is not complete: the child organization${one ? "" : "s"} ${named} of '${org}' ` +
    `${one ? "is" : "are"} being deleted, and no role there can be revoked until ${one ? "its" : "their"} ` +
    "delete finishes or is refused. The revocations made so far stand; retry the deprovision then."
  );
}

async function requireFederatedAccount(
  accounts: IdentityAccountService,
  ref: ApiResourceReference,
  externalSub: string,
  idpName: () => Promise<string>,
): Promise<IdentityAccount> {
  const account = await accounts.store.findByProviderAndIdpId(ref.id, externalSub);
  if (account === undefined) {
    throw new ConnectError(
      `No federated account found for IdP '${await idpName()}' ` +
        `with external_sub '${externalSub}'`,
      Code.NotFound,
    );
  }
  return account;
}
