/**
 * The one place an identity provider is removed. Pins:
 *   - the provider is marked as being deleted, and the verifier told,
 *     before a single account is listed, so a sign-in through it can no
 *     longer make an account the listing misses (the race itself is pinned
 *     end to end in iam/federation/__tests__/provider-delete-race.test.ts);
 *     a delete that faults leaves the mark, so the provider stays dark;
 *   - the provider's federated accounts are deleted next, each through
 *     the account service's delete acting for the person deleting the
 *     provider, listed by the provider's id, so a provider re-created
 *     under the same slug (another id) inherits no account or role; a failed account delete stops before anything else
 *     and leaves the row, and a retry resumes with the accounts left;
 *   - the grants are revoked (as `identity_provider:<id>`, both
 *     directions, by the grant path) before the row is deleted, acting for
 *     the person deleting it, and the verifier is told once the row is
 *     gone;
 *   - a failed revoke leaves the row, still marked, and tells the verifier
 *     nothing more, so the provider still exists to retry;
 *   - once the row is gone, the provider's accounts are swept once more,
 *     so an account a sign-in or a create wrote after the first sweep is
 *     removed; an account that sweep cannot remove is
 *     logged with its id and the delete still completes, since its row is
 *     gone and a retry would find nothing; a provider already re-created
 *     under the slug keeps its accounts;
 *   - an organization's providers are each removed on their own: one
 *     provider's failure is logged, the rest are still removed, and the
 *     call then throws, so the organization delete stops with the
 *     organization in place; another organization's providers are
 *     untouched.
 */
import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { createLogger } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { newProviderRemoval } from "../removal.js";
import { InMemoryProviderStore, storedProvider } from "./in-memory-provider-store.js";
import { inMemoryNames } from "../../../__test-utils__/in-memory-names.js";

function federated(id: string): IdentityAccount {
  return create(IdentityAccountSchema, { metadata: { id } });
}

/** The person deleting, whom every account delete and revoke is made acting for. */
const DELETER = "ida_deleter";

function rig(
  options: {
    failFor?: ReadonlySet<string>;
    failAccount?: string;
    accounts?: Readonly<Record<string, ReadonlyArray<string>>>;
    /** An account a sign-in writes under a provider's id after the first sweep, while the grants are revoked. */
    lateAccount?: { readonly key: string; readonly id: string };
    /** A provider re-created under the deleted one's slug the moment its row is gone. */
    recreated?: { readonly id: string; readonly org: string; readonly slug: string };
    /** When set, listing the accounts fails once the provider's row is gone. */
    listingFailsAfterRow?: boolean;
  } = {},
) {
  const providers = new InMemoryProviderStore();
  const names = inMemoryNames();
  /** A long-held claim, as a provider made before this test holds its name. */
  const CLAIMED_AT = "2026-09-01T00:00:00.000Z";
  const nameKey = (org: string, slug: string) => ({ kind: "identity_provider", org, name: slug });
  const order: string[] = [];
  // Each provider's accounts by its id; a deleted one leaves the list.
  const accountsByProvider = new Map<string, string[]>(
    Object.entries(options.accounts ?? {}).map(([key, ids]) => [key, [...ids]]),
  );
  const actors: Array<string | undefined> = [];
  /** Whether the provider was still live each time its accounts were listed. */
  const liveAtListing: boolean[] = [];
  const logged: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: "warn",
    pretty: false,
    write: (line: string) => {
      logged.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const removal = newProviderRemoval({
    providers: {
      findById: (id) => providers.findById(id),
      findIdsByOrg: (org) => providers.findIdsByOrg(org),
      markDeleting: async (id) => {
        order.push(`mark:${id}`);
        await providers.markDeleting(id);
      },
      deleteById: async (id) => {
        order.push(`row:${id}`);
        await providers.deleteById(id);
        if (options.recreated !== undefined) {
          const { id: newId, org, slug } = options.recreated;
          await providers.insert(storedProvider(options.recreated));
          // The new provider's create frees the gone holder's name and takes it.
          await names.resourceNames.releaseName(nameKey(org, slug), id);
          await names.resourceNames.claim(nameKey(org, slug), newId, new Date().toISOString());
        }
      },
    },
    names,
    accounts: {
      store: {
        findByProvider: async (providerId) => {
          if (options.listingFailsAfterRow === true && order.some((step) => step.startsWith("row:"))) {
            throw new Error("account store down");
          }
          const listed = await providers.findById(providerId);
          liveAtListing.push(listed !== undefined && (await providers.isLive(providerId)));
          return (accountsByProvider.get(providerId) ?? []).map(federated);
        },
      },
      deleteAccount: (account, actingFor) => {
        const id = account.metadata?.id ?? "";
        actors.push(actingFor);
        order.push(`account:${id}`);
        if (id === options.failAccount) {
          return Promise.reject(new Error("grant path down"));
        }
        for (const ids of accountsByProvider.values()) {
          const at = ids.indexOf(id);
          if (at >= 0) {
            ids.splice(at, 1);
          }
        }
        return Promise.resolve();
      },
    },
    policies: {
      cleanupResourcePolicies: (ref: ApiResourceRef, actingFor?: string) => {
        actors.push(actingFor);
        order.push(`grants:${ref.kind}:${ref.id}`);
        if (options.lateAccount !== undefined) {
          const late = accountsByProvider.get(options.lateAccount.key) ?? [];
          late.push(options.lateAccount.id);
          accountsByProvider.set(options.lateAccount.key, late);
        }
        return options.failFor?.has(ref.id) === true
          ? Promise.reject(new Error("engine down"))
          : Promise.resolve();
      },
    },
    invalidate: () => {
      order.push("invalidate");
    },
    logger,
  });
  /** A provider as its create chain stores it: its row, and its slug as its name. */
  async function seed(id: string, org: string, slug: string): Promise<void> {
    await providers.insert(storedProvider({ id, org, slug }));
    await names.resourceNames.claim(nameKey(org, slug), id, CLAIMED_AT);
  }
  return { providers, names, seed, order, actors, liveAtListing, logged, removal };
}

describe("remove", () => {
  it("marks the provider deleting and forgets it before it lists a single account", async () => {
    const r = rig({ accounts: { "idp_a": ["ida_1"] } });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(r.order.slice(0, 3)).toEqual(["mark:idp_a", "invalidate", "account:ida_1"]);
    expect(r.liveAtListing, "the accounts are listed only once the provider is no longer live").toEqual([false, false]);
  });

  it("deletes the provider's accounts, then revokes its grants, then deletes the row and tells the verifier", async () => {
    const r = rig({ accounts: { "idp_a": ["ida_1", "ida_2"], "idp_b": ["ida_9"] } });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(r.order).toEqual([
      "mark:idp_a",
      "invalidate",
      "account:ida_1",
      "account:ida_2",
      "grants:identity_provider:idp_a",
      "row:idp_a",
      "invalidate",
    ]);
    expect(
      r.actors,
      "each account delete and the revoke are made acting for the person deleting the provider",
    ).toEqual([DELETER, DELETER, DELETER]);
    expect(await r.providers.findById("idp_a")).toBeUndefined();
  });

  it("stops at a failed account delete with the row and the grants in place and the provider dark, and a retry resumes", async () => {
    const r = rig({ accounts: { "idp_a": ["ida_1", "ida_2", "ida_3"] }, failAccount: "ida_2" });
    await r.seed("idp_a", "acme", "a");

    await expect(r.removal.remove("idp_a", DELETER)).rejects.toThrow("grant path down");
    expect(r.order).toEqual(["mark:idp_a", "invalidate", "account:ida_1", "account:ida_2"]);
    expect(await r.providers.findById("idp_a")).toBeDefined();
    expect(await r.providers.isLive("idp_a"), "a faulted delete keeps its mark").toBe(false);

    const retry = rig({ accounts: { "idp_a": ["ida_2", "ida_3"] } });
    await retry.seed("idp_a", "acme", "a");
    await retry.providers.markDeleting("idp_a");
    await retry.removal.remove("idp_a", DELETER);
    expect(retry.order.slice(0, 5)).toEqual([
      "mark:idp_a",
      "invalidate",
      "account:ida_2",
      "account:ida_3",
      "grants:identity_provider:idp_a",
    ]);
    expect(await retry.providers.findById("idp_a")).toBeUndefined();
  });

  it("leaves the row marked, and tells the verifier nothing more, when the grants cannot all be revoked", async () => {
    const r = rig({ failFor: new Set(["idp_a"]) });
    await r.seed("idp_a", "acme", "a");

    await expect(r.removal.remove("idp_a", DELETER)).rejects.toThrow("engine down");
    expect(r.order).toEqual(["mark:idp_a", "invalidate", "grants:identity_provider:idp_a"]);
    expect(await r.providers.findById("idp_a")).toBeDefined();
    expect(await r.providers.isLive("idp_a")).toBe(false);
  });
});

describe("remove: the sweep after the row", () => {
  it("removes an account a sign-in wrote after the first sweep, once the row is gone", async () => {
    const r = rig({ accounts: { "idp_a": ["ida_1"] }, lateAccount: { key: "idp_a", id: "ida_late" } });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(r.order).toEqual([
      "mark:idp_a",
      "invalidate",
      "account:ida_1",
      "grants:identity_provider:idp_a",
      "row:idp_a",
      "invalidate",
      "account:ida_late",
    ]);
    expect(r.actors.at(-1), "acting for the person deleting the provider").toBe(DELETER);
  });

  it("logs an account the last sweep cannot remove, by its id, and still completes the delete", async () => {
    const r = rig({ lateAccount: { key: "idp_a", id: "ida_late" }, failAccount: "ida_late" });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(await r.providers.findById("idp_a")).toBeUndefined();
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({
      level: "error",
      accountId: "ida_late",
      provider: "idp_a",
      idp: "acme/a",
      error: "grant path down",
    });
  });

  it("logs a last sweep that cannot list the accounts, and still completes the delete", async () => {
    const r = rig({ accounts: { "idp_a": ["ida_1"] }, listingFailsAfterRow: true });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(await r.providers.findById("idp_a")).toBeUndefined();
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({
      level: "error",
      message: "the last sweep of a deleted identity provider's accounts could not list them",
      provider: "idp_a",
      idp: "acme/a",
      error: "account store down",
    });
  });

  it("leaves the accounts of a provider re-created under the slug the moment the row went", async () => {
    const r = rig({
      accounts: { "idp_a": [] },
      // The new provider's accounts sit under its own id.
      lateAccount: { key: "idp_a2", id: "ida_of_the_new_provider" },
      recreated: { id: "idp_a2", org: "acme", slug: "a" },
    });
    await r.seed("idp_a", "acme", "a");

    await r.removal.remove("idp_a", DELETER);
    expect(r.order).not.toContain("account:ida_of_the_new_provider");
  });
});

describe("removeByOrgId", () => {
  it("removes each of the organization's providers on its own, logs the one that failed, then throws", async () => {
    const r = rig({ failFor: new Set(["idp_b"]) });
    await r.seed("idp_a", "acme", "a");
    await r.seed("idp_b", "acme", "b");
    await r.seed("idp_c", "acme", "c");
    await r.seed("idp_x", "other", "x");

    await expect(r.removal.removeByOrgId("acme", DELETER)).rejects.toThrow(
      "1 identity provider(s) of organization 'acme' could not be removed",
    );

    expect(await r.providers.findIdsByOrg("acme")).toEqual(["idp_b"]);
    expect(await r.providers.findIdsByOrg("other")).toEqual(["idp_x"]);
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({ provider: "idp_b", org: "acme", error: "engine down" });
  });

  it("resolves when every provider is removed", async () => {
    const r = rig();
    await r.seed("idp_a", "acme", "a");

    await r.removal.removeByOrgId("acme", DELETER);

    expect(await r.providers.findIdsByOrg("acme")).toEqual([]);
    expect(r.logged).toEqual([]);
  });
});

describe("the provider's name release", () => {
  it("logs a release that faults and still removes the provider: the next claim frees the name", async () => {
    const providers = new InMemoryProviderStore();
    await providers.insert(storedProvider({ id: "idp_gone", org: "acme", slug: "gone" }));
    const logged: Array<Record<string, unknown>> = [];
    const removal = newProviderRemoval({
      providers,
      names: {
        resourceNames: {
          resolve: () => Promise.resolve(undefined),
          release: () => Promise.reject(new Error("name table down")),
        },
      } as unknown as Parameters<typeof newProviderRemoval>[0]["names"],
      accounts: {
        store: { findByProvider: () => Promise.resolve([]) },
        deleteAccount: () => Promise.resolve(),
      },
      policies: { cleanupResourcePolicies: () => Promise.resolve() },
      invalidate: () => {},
      logger: createLogger({
        level: "error",
        pretty: false,
        write: (line: string) => {
          logged.push(JSON.parse(line) as Record<string, unknown>);
        },
      }),
    });

    await removal.remove("idp_gone", "ida_deleter");
    expect(await providers.findById("idp_gone")).toBeUndefined();
    expect(logged.map((line) => line["msg"] ?? line["message"])).toEqual([
      expect.stringMatching(/its name could not be released/),
    ]);
  });
});
