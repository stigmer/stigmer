/**
 * The one place an identity provider is removed: the delete RPC and the
 * organization delete both come here, so "a provider dies" has one order.
 *
 * First the provider is marked as being deleted, and this process's
 * routing cache forgets it. That ends every new sign-in through it, on
 * every process, before anything is removed; it is the library's own
 * order for an organization's delete (MarkDeleting, then the removals),
 * and the reason is the same race. A first sign-in creates an account and
 * grants its role from a routing cache up to `ISSUER_CACHE_TTL_MS` old, so an account
 * created after this removal listed the provider's accounts would outlive
 * it, keeping its role and any API key it minted. With the mark, each
 * side writes and then reads the other's write, so at least one sees the
 * other: an account committed before the mark is listed below, since the
 * listing starts after the mark; a sign-in that writes after the mark
 * re-reads the provider before it answers, finds it no longer live, and
 * undoes its own write (iam/federation/verifier.ts). The mark is never
 * lifted: a delete that faults leaves the provider dark, still listed for
 * its admins, until its delete runs again, because the delete exists to
 * end the trust and nothing else would finish it.
 *
 * Then what answers for the provider, the row last, and a failure
 * stops before the row: Team's order (team/removal.ts), for the same
 * reason. First the provider's federated accounts, each through the
 * account service's delete (its policies in both directions, then its
 * row). They are keyed by the provider's id, so a provider re-created
 * under the same slug never inherits them; left in place they would still
 * be accounts nobody's provider vouches for, with their roles. A retry
 * resumes, since an account already deleted is no longer listed. Then the grants: the grant path's
 * `cleanupResourcePolicies` revokes the provider's rows as resource (its
 * organization link, viewer grants, and any owner row an older server
 * wrote) and as principal. A deleted row with a failed cleanup would leave
 * a provider nobody can manage still granting; here the row stays and the
 * retry resumes. The routing cache is told again once the row is gone.
 *
 * Then the accounts once more. Two writes can land
 * after the first sweep listed the accounts: a sign-in whose re-read could
 * not undo its own write, and the account service's create arm
 * (identity-federation.ts), which checks before it writes. Each re-reads
 * the provider after it writes and undoes itself when the provider is
 * gone, so any write that lands after this last sweep removes itself; this
 * sweep removes those that landed before it. What is left needs two faults
 * in a row (a write after this sweep, then its own undo failing), and that
 * undo logs the account's id. This sweep cannot fail the delete: the row
 * is gone, and a retry would find no provider to sweep, so an account it
 * cannot remove is logged by its id instead. It lists by the removed
 * provider's id, so a provider made since under its slug is never swept.
 *
 * Child organizations do not hang off a provider: they name their parent
 * organization, so removing a provider removes no child and refuses no
 * delete. A sign-in its `external_id_claim` routed is simply no longer
 * accepted, and a new provider with the same claim routes it again.
 *
 * The organization delete runs this before the organization's row goes,
 * and a failure stops that delete: a provider left behind would be trust
 * configuration nobody administers (the verifier refuses such a
 * provider, organization-links.ts `orphanReason`, and no later
 * organization carries its organization's id, but it would still hold its
 * routes).
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IdentityAccountStore, Logger, NameTable } from "@stigmer/server";

import type { IdentityAccountService } from "../account/port.js";
import type { IamPolicyGrantPathClient } from "../policy/grant-path-client.js";
import type { IdentityProviderStore } from "./store.js";

/** The provider's kind as an `ApiResourceRef.kind` spells it. */
export const IDENTITY_PROVIDER_KIND_NAME = ApiResourceKind[ApiResourceKind.identity_provider];

export interface ProviderRemoval {
  /**
   * The provider's delete mark, then its accounts and grants, then its
   * row; throws with the row intact, and still marked, when any of them
   * cannot be removed. `actingFor`: the person deleting it.
   */
  remove(id: string, actingFor: string): Promise<void>;
  /**
   * Every provider of an organization being deleted, each on its own: one
   * provider's failure is logged and the rest are still removed, then the
   * call throws, so the organization delete fails with the organization in
   * place and its retry removes what is left. `actingFor`: the person
   * deleting the organization.
   */
  removeByOrgId(orgId: string, actingFor: string): Promise<void>;
}

export interface ProviderRemovalDeps {
  readonly providers: Pick<
    IdentityProviderStore,
    "findById" | "findIdsByOrg" | "markDeleting" | "deleteById"
  >;
  /** The server's one name table: a removed provider's slug is let go after its last sweep. */
  readonly names: NameTable;
  /** The provider's federated accounts: listed by its id, each deleted with its policies. */
  readonly accounts: Pick<IdentityAccountService, "deleteAccount"> & {
    readonly store: Pick<IdentityAccountStore, "findByProvider">;
  };
  readonly policies: Pick<IamPolicyGrantPathClient, "cleanupResourcePolicies">;
  /** The federated verifier's issuer-cache invalidation. */
  readonly invalidate: () => void;
  readonly logger: Logger;
}

export function newProviderRemoval(deps: ProviderRemovalDeps): ProviderRemoval {
  /** The last sweep, after the row: never throws (the module header says why). */
  async function sweepAfterRow(id: string, org: string, slug: string, actingFor: string): Promise<void> {
    const report = (message: string, fields: Record<string, string>, error: unknown): void => {
      deps.logger.error(message, {
        provider: id,
        idp: `${org}/${slug}`,
        ...fields,
        error: error instanceof Error ? error.message : String(error),
      });
    };
    let accounts: ReadonlyArray<IdentityAccount>;
    try {
      // Keyed by the provider's id: a provider made since under the same
      // name is another id, and its accounts are never this sweep's.
      accounts = await deps.accounts.store.findByProvider(id);
    } catch (error) {
      report("the last sweep of a deleted identity provider's accounts could not list them", {}, error);
      return;
    }
    for (const account of accounts) {
      try {
        await deps.accounts.deleteAccount(account, actingFor);
      } catch (error) {
        report(
          "an account made during its identity provider's delete could not be removed",
          { accountId: account.metadata?.id ?? "" },
          error,
        );
      }
    }
  }

  async function remove(id: string, actingFor: string): Promise<void> {
    const provider = await deps.providers.findById(id);
    if (provider !== undefined) {
      await deps.providers.markDeleting(id);
      deps.invalidate();
      for (const account of await deps.accounts.store.findByProvider(id)) {
        await deps.accounts.deleteAccount(account, actingFor);
      }
    }
    await deps.policies.cleanupResourcePolicies(
      create(ApiResourceRefSchema, { kind: IDENTITY_PROVIDER_KIND_NAME, id }),
      actingFor,
    );
    await deps.providers.deleteById(id);
    deps.invalidate();
    if (provider !== undefined) {
      await sweepAfterRow(id, provider.metadata?.org ?? "", provider.metadata?.slug ?? "", actingFor);
      await releaseProviderNames(id, provider.metadata?.org ?? "");
    }
  }

  /**
   * Lets the removed provider's names go, after its last sweep. Best-effort, as every delete's post-row release is, since the next
   * claim of the slug frees a name whose provider is gone.
   */
  async function releaseProviderNames(id: string, org: string): Promise<void> {
    try {
      await deps.names.resourceNames.release(IDENTITY_PROVIDER_KIND_NAME, org, id);
    } catch (error) {
      deps.logger.error("identity provider removed but its name could not be released; a later claim frees it", {
        provider: id,
        org,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    remove,
    async removeByOrgId(orgId, actingFor): Promise<void> {
      let failed = 0;
      for (const id of await deps.providers.findIdsByOrg(orgId)) {
        try {
          await remove(id, actingFor);
        } catch (error) {
          failed += 1;
          deps.logger.error(
            "identity provider removal failed with its organization; the provider row and its policies remain",
            {
              provider: id,
              org: orgId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      if (failed > 0) {
        throw new Error(`${failed} identity provider(s) of organization '${orgId}' could not be removed`);
      }
    },
  };
}
