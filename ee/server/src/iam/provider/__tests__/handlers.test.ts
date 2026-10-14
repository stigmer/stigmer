/**
 * The IdentityProvider RPCs over a router transport with the serving
 * chain's identity stamp (the Team suite's idiom), an in-memory store, a
 * recording authorizer, recording lifecycle, removal and list-scope
 * fakes, and the REAL guarded fetch over the strict posture the
 * composition registers (a scripted underlying fetch and a lookup table,
 * so the egress judgement runs exactly as production runs it and no test
 * touches DNS or a socket).
 *
 * Pins, in the order a reviewer would ask:
 *   - create shapes the envelope the OSS way (an `idp_` id the server
 *     minted, whatever id the request carried; the slug from the name;
 *     the audit stamped for the caller), writes the row, tells the
 *     verifier, then fires the creation event: the organization link, no
 *     owner (the kind records none) and no visibility tuple;
 *   - a slug held in the organization is ALREADY_EXISTS with the
 *     provider's copy before any dial, and from the insert race alike; a
 *     route (issuer and audience) another provider holds is ALREADY_EXISTS
 *     with the route copy, from the pre-check and the insert race alike,
 *     while another organization's own audience at the same issuer is
 *     admitted;
 *   - two spellings of one issuer are kept once, on create and on update,
 *     never refused as a route another provider holds;
 *   - a failed creation event is INTERNAL with the row in place and the
 *     verifier told;
 *   - update keeps the id, slug, organization and creation audit through
 *     the OSS BuildUpdateState, and a provider deleted underneath it is
 *     NOT_FOUND;
 *   - apply first asks create's own question on the request's
 *     organization, so a caller who is not its admin reads create's
 *     refusal whether or not the slug exists; then it creates through the
 *     create door, or updates the row it resolved by org and slug through
 *     the update door, never the id the request carried;
 *   - delete goes through the removal; a child organization depends on no
 *     provider, so nothing refuses it;
 *   - an external id claim is refused on a provider of a child
 *     organization, and accepted on a parent's;
 *   - getByReference authorizes a found row exactly as `get`, with `get`'s
 *     copy, and answers a missing slug NOT_FOUND only to the
 *     organization's admins, and `get`'s denial to anyone else, a viewer of
 *     the organization included;
 *   - list offers the organization's rows, newest first, to the list
 *     read scope and answers only what it allows, a page and a token at a
 *     time to the end, 50 at size 0, and refuses a token issued for another
 *     organization;
 *   - a provider whose delete did not finish refuses an update and an
 *     apply, FAILED_PRECONDITION, with copy that says to delete it again,
 *     after the caller's authorization and with nothing written;
 *   - the save-time URL rules: a provider whose issuer
 *     publishes a discovery document naming its JWKS, which serves keys,
 *     is accepted; an issuer at a loopback, link-local, private or mixed
 *     address is refused undialed with no row written, and the copy names
 *     no resolved address; a JWKS the document names at an internal host,
 *     or behind a redirect to one, is refused likewise; a name that does
 *     not resolve reads exactly as one the policy refuses, for the issuer
 *     and the JWKS alike; an unreachable public JWKS says so without the
 *     fetch's cause; a userinfo endpoint
 *     that is not an HTTPS URL is refused before anything is dialed;
 *   - the discovery binding: an issuer that is not HTTPS, whose document
 *     is missing, is not JSON, or names another issuer is refused; so is a
 *     jwks_uri or userinfo_endpoint other than the document's, and an
 *     audience that is a URL the document names; the host's own sign-in
 *     issuer is refused before anything is dialed;
 *   - the sign-in fields on save: an owner sign-in role is refused by the
 *     contract's rule on create, update and both apply doors with nothing
 *     written and nothing dialed, while admin, member and viewer are
 *     accepted; a tenant claim that grants nothing is accepted;
 *   - rename asks can_delete on the provider, keeps its id and its routes,
 *     tells the verifier, leaves the old slug leading to it and refused to
 *     a create with SLUG_RESERVED and to an apply without the id with
 *     SLUG_RENAMED; an apply carrying the id finds the provider by it; an
 *     update that loaded the provider before a rename keeps the new slug;
 *     a provider being deleted and a service account's call are refused.
 */
import { create } from "@bufbuild/protobuf";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type Interceptor,
} from "@connectrpc/connect";
import {
  guardedFetch,
  type LookupFn,
  type OutboundFetch,
} from "@stigmer/outbound/egress";
import type {
  Authorizer,
  AuthzCheck,
  ListEntryMeta,
  ListReadScope,
  Logger,
  ResourceCreatedEvent,
} from "@stigmer/server";
import { callerIdentityKey, createLogger, strictEgressPolicy, RequestContext } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { IdentityProviderSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/spec_pb";
import { IamPermission, IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { newIdentityProviderRegistrations, type IdentityProviderLaneDeps } from "../handlers.js";
import type { ProviderInsertOutcome, ProviderSwapOutcome } from "../store.js";
import { newLoadProviderByReferenceStep, PROVIDER_BEING_DELETED_MESSAGE } from "../steps.js";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { InMemoryProviderStore, storedProvider } from "./in-memory-provider-store.js";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { inMemoryNames } from "../../../__test-utils__/in-memory-names.js";

const ADMIN = "ida_admin";
const JWKS = "https://idp.acme.test/.well-known/jwks.json";
const USERINFO = "https://idp.acme.test/userinfo";
const AUDIENCE = "https://api.acme.test/stigmer";
const DISCOVERY = "https://idp.acme.test/.well-known/openid-configuration";

/** The route copy: the pair the caller wrote, the way forward, and never who holds it. */
const ROUTE_TAKEN =
  `Issuer 'https://idp.acme.test' with audience '${AUDIENCE}' is already registered by another ` +
  "identity provider. Register an audience of your organization's own for Stigmer at this " +
  "issuer, such as an API identifier or a client ID, and use it here.";

/** create's own question on the request's organization, which apply and a missing reference ask too. */
const CREATE_IDP_ON_ACME: AuthzCheck = {
  permission: IamPermission.can_create_idp,
  resourceKind: ApiResourceKind.organization,
  resourceId: "acme",
};

const silent: Logger = createLogger({ level: "error", pretty: false, write: () => {} });

/** Public names answer public addresses; the two traps answer a private one. */
const lookup: LookupFn = (hostname) => {
  const table: Record<string, readonly string[]> = {
    "idp.acme.test": ["104.16.0.1"],
    "login.acme.test": ["104.16.0.3"],
    "other.idp.test": ["104.16.0.4"],
    "nodoc.acme.test": ["104.16.0.5"],
    "jwks.internal.test": ["10.0.0.5"],
    "mixed.acme.test": ["104.16.0.2", "10.0.0.6"],
  };
  const found = table[hostname];
  return found === undefined
    ? Promise.reject(new Error(`ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

const KEYS = JSON.stringify({ keys: [{ kty: "RSA", kid: "k1", n: "AQAB", e: "AQAB" }] });

/** An issuer's discovery document, in Auth0's shape (the issuer with its trailing slash). */
function discoveryDocument(
  issuer: string,
  fields: { jwksUri?: string; userinfo?: string; issuerAs?: string } = {},
): () => Response {
  return () =>
    new Response(
      JSON.stringify({
        issuer: fields.issuerAs ?? `${issuer}/`,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        userinfo_endpoint: fields.userinfo ?? `${issuer}/userinfo`,
        jwks_uri: fields.jwksUri ?? JWKS,
      }),
    );
}

/** The issuers the suite's providers name, each publishing a document that names JWKS. */
const PUBLISHED: Record<string, () => Response> = {
  [DISCOVERY]: discoveryDocument("https://idp.acme.test"),
  "https://login.acme.test/.well-known/openid-configuration": discoveryDocument("https://login.acme.test"),
  "https://other.idp.test/.well-known/openid-configuration": discoveryDocument("https://other.idp.test"),
  [JWKS]: () => new Response(KEYS),
};

/** The underlying fetch: scripted answers by URL, every dial recorded. */
function scripted(answers: Record<string, () => Response>): {
  readonly fetchImpl: OutboundFetch;
  readonly dialed: string[];
} {
  const dialed: string[] = [];
  const fetchImpl: OutboundFetch = (url) => {
    const key = String(url);
    dialed.push(key);
    const answer = answers[key];
    return answer === undefined
      ? Promise.reject(new TypeError("fetch failed"))
      : Promise.resolve(answer());
  };
  return { fetchImpl, dialed };
}

function identityInterceptor(): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, {
      identityId: ADMIN,
      callerClass: "user",
      issuer: "https://issuer.invalid",
      rawToken: "tok",
    });
    return next(request);
  };
}

interface Rig {
  readonly commands: ReturnType<typeof createClient<typeof IdentityProviderCommandController>>;
  readonly queries: ReturnType<typeof createClient<typeof IdentityProviderQueryController>>;
  readonly store: InMemoryProviderStore;
  readonly checks: AuthzCheck[];
  readonly created: ResourceCreatedEvent[];
  readonly removed: string[];
  readonly offered: ListEntryMeta[][];
  readonly dialed: string[];
  /** How many times the verifier was told of a write. */
  readonly invalidations: number;
}

function rig(
  options: {
    answers?: Record<string, () => Response>;
    decide?: (check: AuthzCheck) => "allow" | "deny";
    store?: InMemoryProviderStore;
    onCreated?: () => Promise<void>;
    onRemove?: () => Promise<void>;
    listable?: (id: string) => boolean;
    reservedIssuers?: ReadonlyArray<string>;
    /** The caller's account is an organization's service account. */
    callerIsServiceAccount?: boolean;
    /** Each organization's parent, by id; absent from it, an organization has none. */
    parents?: ReadonlyMap<string, string>;
    /** Each organization's slug, by id; absent from it, an organization's slug is its id. */
    slugs?: ReadonlyMap<string, string>;
  } = {},
): Rig {
  const store = options.store ?? new InMemoryProviderStore();
  const names = inMemoryNames(async (key) =>
    store.inOrg(key.org).find((held) => held.metadata?.slug === key.name)?.metadata?.id,
  );
  const underlying = scripted({ ...PUBLISHED, ...options.answers });
  const checks: AuthzCheck[] = [];
  const created: ResourceCreatedEvent[] = [];
  const removed: string[] = [];
  const offered: ListEntryMeta[][] = [];
  const authorizer: Authorizer = {
    authorize: (_caller, check) => {
      checks.push(check);
      const decision = options.decide?.(check) ?? "allow";
      return Promise.resolve(
        decision === "allow" ? { kind: "allow" } : { kind: "deny", reason: "" },
      );
    },
  };
  const listReadScope: ListReadScope = {
    authorizedResourceIds: () => Promise.reject(new Error("the provider list restricts, never enumerates")),
    restrictListEntries: (_caller, _kind, entries) => {
      offered.push([...entries]);
      const allowed = options.listable ?? (() => true);
      return Promise.resolve(new Set(entries.map((e) => e.id).filter(allowed)));
    },
  };
  const invalidated = { count: 0 };
  const deps: IdentityProviderLaneDeps = {
    // The caller's row, which the refusal of a service account reads.
    accounts: {
      findById: (id) =>
        Promise.resolve(
          options.callerIsServiceAccount === true && id === ADMIN
            ? create(IdentityAccountSchema, {
                metadata: { id: ADMIN, org: "acme" },
                spec: { idpId: "stgm_sa|acme|0f", provisioningMode: IdentityAccountProvisioningMode.service_account },
              })
            : undefined,
        ),
    },
    authorizer,
    logger: silent,
    store,
    names,
    outboundFetch: guardedFetch(strictEgressPolicy(), {
      fetchImpl: underlying.fetchImpl,
      lookup,
    }),
    reservedIssuers: options.reservedIssuers ?? [],
    removal: {
      remove: async (id) => {
        await options.onRemove?.();
        removed.push(id);
      },
    },
    lifecycle: {
      onResourceCreated: async (event) => {
        await options.onCreated?.();
        created.push(event);
      },
    },
    listReadScope,
    invalidate: () => {
      invalidated.count += 1;
    },
    organizations: {
      find: (org) =>
        Promise.resolve({
          createdAt: new Date("2026-09-01T00:00:00Z"),
          name: org,
          slug: options.slugs?.get(org) ?? org,
          logoUrl: "",
          parentOrg: options.parents?.get(org) ?? "",
        }),
    },
  };
  const transport = createRouterTransport(
    (router) => {
      for (const register of newIdentityProviderRegistrations(deps)) {
        register(router);
      }
    },
    { router: { interceptors: [identityInterceptor()] } },
  );
  return {
    commands: createClient(IdentityProviderCommandController, transport),
    queries: createClient(IdentityProviderQueryController, transport),
    store,
    checks,
    created,
    removed,
    offered,
    dialed: underlying.dialed,
    get invalidations(): number {
      return invalidated.count;
    },
  };
}

/** The message the generated SDK client sends for a provider. */
function provider(
  spec: { jwksUri?: string; userinfoEndpoint?: string; issuers?: string[]; audience?: string } = {},
  metadata: { name?: string; org?: string; id?: string; slug?: string } = {},
): IdentityProvider {
  return create(IdentityProviderSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityProvider",
    metadata: create(ApiResourceMetadataSchema, {
      name: metadata.name ?? "Acme Platform",
      org: metadata.org ?? "acme",
      id: metadata.id ?? "",
      slug: metadata.slug ?? "",
    }),
    spec: create(IdentityProviderSpecSchema, {
      displayName: "Acme Platform",
      jwksUri: spec.jwksUri ?? JWKS,
      allowedIssuers: spec.issuers ?? ["https://idp.acme.test/"],
      expectedAudience: spec.audience ?? AUDIENCE,
      userinfoEndpoint: spec.userinfoEndpoint ?? "",
    }),
  });
}

async function failure(work: Promise<unknown>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a ConnectError");
}

describe("an organization's service account", () => {
  it("is refused every write, before any check or write, whatever credential speaks for it", async () => {
    const r = rig({ callerIsServiceAccount: true });
    await r.store.insert(storedProvider({ id: "idp_existing", org: "acme", slug: "acme-existing" }));
    const attempts: ReadonlyArray<() => Promise<unknown>> = [
      () => r.commands.create(provider()),
      () => r.commands.apply(provider()),
      () => r.commands.update({ resource: provider({}, { id: "idp_existing", slug: "acme-existing" }), updateMask: { paths: ["*"] } }),
      () => r.commands.delete({ resourceId: "idp_existing" }),
    ];
    for (const attempt of attempts) {
      const error = await failure(attempt());
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        "a service account cannot create, change or delete identity providers; an organization admin must do it",
      );
    }
    expect(r.removed).toEqual([]);
    expect(r.invalidations).toBe(0);
  });
});

describe("create", () => {
  it("shapes the envelope the OSS way, writes the row, tells the verifier, then fires the link and no owner", async () => {
    const r = rig();
    const created = await r.commands.create(provider());

    expect(created.metadata?.id).toMatch(/^idp_[0-9a-z]{26}$/);
    expect(created.metadata?.slug).toBe("acme-platform");
    expect(created.spec?.allowedIssuers).toEqual(["https://idp.acme.test"]);
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(ADMIN);
    expect(await r.store.findById(created.metadata?.id ?? "")).toEqual(created);
    expect(r.invalidations).toBe(1);

    expect(r.checks).toEqual([
      {
        permission: IamPermission.can_create_idp,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
    expect(r.created).toHaveLength(1);
    const event = r.created[0]!;
    expect(event.kind).toBe(ApiResourceKind.identity_provider);
    expect(event.resourceId).toBe(created.metadata?.id);
    expect(event.orgId).toBe("acme");
    expect(event.ownerAttribution).toBe(OwnerAttributionType.NONE);
    expect(event.visibilityShapes).toEqual([]);
    expect(event.parentLinks).toEqual([
      {
        parentKind: ApiResourceKind.organization,
        parentId: "acme",
        relation: "organization",
      },
    ]);
  });

  it("mints its own id whatever id the request carried", async () => {
    const r = rig();
    const created = await r.commands.create(provider({}, { id: "idp_chosen_by_caller" }));
    expect(created.metadata?.id).not.toBe("idp_chosen_by_caller");
    expect(created.metadata?.id).toMatch(/^idp_[0-9a-z]{26}$/);
    expect(await r.store.findById("idp_chosen_by_caller")).toBeUndefined();
  });

  it("refuses a slug the organization holds with the provider's copy, before any dial", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform" }));

    const refused = await failure(r.commands.create(provider({})));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(
      "IdentityProvider already exists: slug 'acme-platform' in org 'acme'",
    );
    expect(r.dialed).toEqual([]);

    const elsewhere = await r.commands.create(provider({ issuers: ["https://other.idp.test"] }, { org: "other" }));
    expect(elsewhere.metadata?.slug).toBe("acme-platform");
  });

  it("answers the same copy when the insert loses the slug race the pre-check could not see", async () => {
    class RacingStore extends InMemoryProviderStore {
      override async insert(row: IdentityProvider): Promise<ProviderInsertOutcome> {
        await super.insert(storedProvider({ id: "idp_winner", org: "acme", slug: "acme-platform", issuers: [] }));
        return super.insert(row);
      }
    }
    const r = rig({ store: new RacingStore() });

    const refused = await failure(r.commands.create(provider()));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(
      "IdentityProvider already exists: slug 'acme-platform' in org 'acme'",
    );
    expect(r.created).toEqual([]);
    expect(r.invalidations).toBe(0);
  });

  it("answers the route copy when a racing create claimed the route first", async () => {
    class RacingStore extends InMemoryProviderStore {
      override async insert(row: IdentityProvider): Promise<ProviderInsertOutcome> {
        await super.insert(
          storedProvider({
            id: "idp_winner",
            org: "other",
            slug: "winner",
            issuers: ["https://idp.acme.test"],
            expectedAudience: AUDIENCE,
          }),
        );
        return super.insert(row);
      }
    }
    const r = rig({ store: new RacingStore() });

    const refused = await failure(r.commands.create(provider()));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(ROUTE_TAKEN);
  });

  it("refuses a route another organization's provider holds, and admits that organization's own audience at the issuer", async () => {
    const r = rig();
    await r.store.insert(
      storedProvider({
        id: "idp_first",
        org: "first",
        slug: "first",
        issuers: ["https://idp.acme.test"],
        expectedAudience: AUDIENCE,
      }),
    );

    const refused = await failure(r.commands.create(provider()));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(ROUTE_TAKEN);
    expect(r.store.size).toBe(1);

    const own = await r.commands.create(provider({ audience: "https://api.acme.test/own" }));
    expect(own.spec?.allowedIssuers).toEqual(["https://idp.acme.test"]);
    expect(own.spec?.expectedAudience).toBe("https://api.acme.test/own");
    expect(r.store.size).toBe(2);
  });

  it("keeps one copy of an issuer written in two spellings, and saves", async () => {
    const r = rig();
    const created = await r.commands.create(
      provider({ issuers: ["https://idp.acme.test", "https://IDP.acme.test/"] }),
    );

    expect(created.spec?.allowedIssuers).toEqual(["https://idp.acme.test"]);
    expect(await r.store.findProviderIdByRoute("https://idp.acme.test", AUDIENCE)).toBe(
      created.metadata?.id,
    );
  });

  it("fails as INTERNAL when the creation event fails, with the row in place and the verifier told", async () => {
    const r = rig({ onCreated: () => Promise.reject(new Error("engine down")) });

    const failed = await failure(r.commands.create(provider()));
    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe("failed to create authorization tuples");
    expect(r.store.inOrg("acme").map((held) => held.metadata?.slug)).toContain("acme-platform");
    expect(r.invalidations).toBe(1);
  });

  it("writes nothing when the caller may not create providers", async () => {
    const r = rig({ decide: () => "deny" });

    const denied = await failure(r.commands.create(provider()));
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to create identity provider in this organization");
    expect(r.store.size).toBe(0);
    expect(r.created).toEqual([]);
  });

  it("refuses a message without the resource constants", async () => {
    const r = rig();
    const bare = provider();
    bare.kind = "";

    const refused = await failure(r.commands.create(bare));
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(r.store.size).toBe(0);
  });
});

describe("update", () => {
  it("replaces what a client may change and keeps the id, slug, organization and creation audit", async () => {
    const r = rig();
    const created = await r.commands.create(provider());
    const id = created.metadata?.id ?? "";

    const updated = await r.commands.update(
      { resource: provider({ issuers: ["https://login.acme.test/"] }, { id, name: "Acme Login", slug: "renamed" }), updateMask: { paths: ["*"] } },
    );

    expect(updated.metadata?.name).toBe("Acme Login");
    expect(updated.metadata?.slug).toBe("acme-platform");
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.allowedIssuers).toEqual(["https://login.acme.test"]);
    expect(updated.status?.audit?.specAudit?.createdAt).toEqual(
      created.status?.audit?.specAudit?.createdAt,
    );
    expect(r.checks.at(-1)).toEqual({
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.identity_provider,
      resourceId: id,
    });
    expect(await r.store.findById(id)).toEqual(updated);
    expect(r.invalidations).toBe(2);
  });

  it("keeps one copy of an issuer written in two spellings, and saves", async () => {
    const r = rig();
    const created = await r.commands.create(provider());
    const id = created.metadata?.id ?? "";

    const updated = await r.commands.update(
      { resource: provider({ issuers: ["https://login.acme.test/", "https://LOGIN.acme.test"] }, { id }), updateMask: { paths: ["*"] } },
    );

    expect(updated.spec?.allowedIssuers).toEqual(["https://login.acme.test"]);
    expect(await r.store.findById(id)).toEqual(updated);
  });

  it("is NOT_FOUND for a provider that does not exist, and INVALID_ARGUMENT without an id", async () => {
    const r = rig();
    const missing = await failure(r.commands.update({ resource: provider({}, { id: "idp_gone" }), updateMask: { paths: ["*"] } }));
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe("IdentityProvider not found: idp_gone");

    const noId = await failure(r.commands.update({ resource: provider(), updateMask: { paths: ["*"] } }));
    expect(noId.code).toBe(Code.InvalidArgument);
    expect(noId.rawMessage).toBe("resource id is required for update");
  });

  it("is NOT_FOUND when the provider is deleted between the load and the write", async () => {
    class VanishingStore extends InMemoryProviderStore {
      override async swap(id: string, expectedBytes: Uint8Array, row: IdentityProvider): Promise<ProviderSwapOutcome> {
        await this.deleteById(id);
        return super.swap(id, expectedBytes, row);
      }
    }
    const store = new VanishingStore();
    await store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" }));
    const r = rig({ store });

    const missing = await failure(r.commands.update({ resource: provider({}, { id: "idp_a" }), updateMask: { paths: ["*"] } }));
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe("IdentityProvider not found: idp_a");
    expect(r.invalidations).toBe(0);
  });

});

describe("rename", () => {
  it("asks can_delete, keeps the id and the routes, tells the verifier, and leaves the old slug leading to the provider", async () => {
    const r = rig();
    const created = await r.commands.create(provider());
    const id = created.metadata?.id ?? "";
    const before = r.invalidations;

    const renamed = await r.commands.rename({ resourceId: id, slug: "acme-sso" });
    expect(renamed.metadata?.id).toBe(id);
    expect(renamed.metadata?.slug).toBe("acme-sso");
    expect(renamed.status?.audit?.specAudit?.event).toBe("renamed");
    expect(r.checks.at(-1)).toEqual({ permission: IamPermission.can_delete, resourceKind: ApiResourceKind.identity_provider, resourceId: id });
    expect(r.invalidations).toBe(before + 1);
    expect(await r.store.findProviderIdByRoute("https://idp.acme.test", AUDIENCE), "the route is unchanged").toBe(id);

    const byOld = await r.queries.getByReference(create(ApiResourceReferenceSchema, { org: "acme", slug: "acme-platform" }));
    expect(byOld.metadata?.slug).toBe("acme-sso");

    const reserved = await failure(r.commands.create(provider({ issuers: ["https://other.acme.test/"] })));
    expect(reserved.code).toBe(Code.AlreadyExists);
    expect(reserved.findDetails(ErrorInfoSchema)[0]?.reason).toBe("SLUG_RESERVED");

    const stale = await failure(r.commands.apply(provider()));
    expect(stale.code).toBe(Code.FailedPrecondition);
    expect(stale.findDetails(ErrorInfoSchema)[0]?.reason).toBe("SLUG_RENAMED");
    expect(stale.rawMessage).not.toContain("acme-sso");

    const byId = await r.commands.apply(provider({}, { id }));
    expect(byId.metadata?.id, "an apply carrying the id finds it").toBe(id);
    expect(byId.metadata?.slug).toBe("acme-sso");
  });

  it("an update that loaded the provider before a rename loses its swap, runs again, and keeps the new slug", async () => {
    let renameMidWrite: (() => Promise<unknown>) | undefined;
    let swaps = 0;
    class RacingStore extends InMemoryProviderStore {
      override async swap(id: string, expectedBytes: Uint8Array, row: IdentityProvider): Promise<ProviderSwapOutcome> {
        swaps += 1;
        const rename = renameMidWrite;
        renameMidWrite = undefined;
        await rename?.();
        return super.swap(id, expectedBytes, row);
      }
    }
    const store = new RacingStore();
    const r = rig({ store });
    const created = await r.commands.create(provider());
    const id = created.metadata?.id ?? "";
    renameMidWrite = () => r.commands.rename({ resourceId: id, slug: "acme-sso" });

    const updated = await r.commands.update({ resource: provider({}, { id, name: "Edited mid-rename", slug: "acme-platform" }), updateMask: { paths: ["*"] } });

    expect(renameMidWrite, "the rename landed mid-write").toBeUndefined();
    expect(swaps, "the lost swap ran again from a fresh read").toBe(2);
    expect(updated.metadata?.slug).toBe("acme-sso");
    const row = await store.findById(id);
    expect(row?.metadata?.slug).toBe("acme-sso");
    expect(row?.metadata?.name).toBe("Edited mid-rename");
  });

  it("is refused for a provider being deleted and for a service account, moving nothing", async () => {
    const marked = rig();
    const created = await marked.commands.create(provider());
    const id = created.metadata?.id ?? "";
    await marked.store.markDeleting(id);
    const deleting = await failure(marked.commands.rename({ resourceId: id, slug: "acme-sso" }));
    expect(deleting.code).toBe(Code.FailedPrecondition);
    expect(deleting.rawMessage).toBe(PROVIDER_BEING_DELETED_MESSAGE);
    expect((await marked.store.findById(id))?.metadata?.slug).toBe("acme-platform");

    const store = new InMemoryProviderStore();
    await store.insert(storedProvider({ id: "idp_sa", org: "acme", slug: "sa", issuers: [] }));
    const serviceAccount = rig({ store, callerIsServiceAccount: true });
    const refused = await failure(serviceAccount.commands.rename({ resourceId: "idp_sa", slug: "sa-renamed" }));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect((await store.findById("idp_sa"))?.metadata?.slug).toBe("sa");
  });
});

describe("apply", () => {
  it("creates through the create door when the organization holds no such slug", async () => {
    const r = rig();
    const applied = await r.commands.apply(provider({}, { id: "idp_from_an_exported_file" }));

    expect(applied.metadata?.id).toMatch(/^idp_[0-9a-z]{26}$/);
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME, CREATE_IDP_ON_ACME]);
    expect(r.created).toHaveLength(1);
  });

  it("updates the row it resolved by org and slug through the update door, never the id the request carried", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_other_org", org: "other", slug: "acme-platform", issuers: [] }));
    await r.store.insert(storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform", issuers: [] }));

    const applied = await r.commands.apply(provider({}, { id: "idp_other_org" }));

    expect(applied.metadata?.id).toBe("idp_held");
    expect(r.checks).toEqual([
      CREATE_IDP_ON_ACME,
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.identity_provider,
        resourceId: "idp_held",
      },
    ]);
    expect((await r.store.findById("idp_other_org"))?.spec?.allowedIssuers).toEqual([]);
    expect(r.created).toEqual([]);
  });
});

describe("apply by a caller who is not the organization's admin", () => {
  it("answers create's refusal whether or not the slug exists, and asks nothing else", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.insert(storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform", issuers: [] }));

    const onHeld = await failure(r.commands.apply(provider()));
    const onFree = await failure(r.commands.apply(provider({}, { name: "Another Platform" })));

    for (const refused of [onHeld, onFree]) {
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe("unauthorized to create identity provider in this organization");
    }
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME, CREATE_IDP_ON_ACME]);
    expect(r.store.size).toBe(1);
  });
});

describe("delete", () => {
  it("goes through the removal and answers the provider", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" }));

    const deleted = await r.commands.delete({ resourceId: "idp_a" });
    expect(deleted.metadata?.id).toBe("idp_a");
    expect(r.removed).toEqual(["idp_a"]);
    expect(r.checks.at(-1)).toEqual({
      permission: IamPermission.can_delete,
      resourceKind: ApiResourceKind.identity_provider,
      resourceId: "idp_a",
    });
  });

  it("is NOT_FOUND for an unknown provider and removes nothing; a failed removal fails the delete", async () => {
    const r = rig({ onRemove: () => Promise.reject(new Error("engine down")) });
    const missing = await failure(r.commands.delete({ resourceId: "idp_gone" }));
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe("IdentityProvider not found: idp_gone");

    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" }));
    const failed = await failure(r.commands.delete({ resourceId: "idp_a" }));
    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).not.toContain("engine down");
    expect(r.removed).toEqual([]);
  });
});

describe("reads", () => {
  it("get answers the provider, and refuses with the annotation's copy", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" }));
    expect((await r.queries.get({ value: "idp_a" })).metadata?.slug).toBe("idp-a");

    const denying = rig({ decide: () => "deny", store: r.store });
    const denied = await failure(denying.queries.get({ value: "idp_a" }));
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to view identity provider");
  });

  it("getByReference authorizes a found row as get, with get's copy", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "alpha" }));

    const denied = await failure(r.queries.getByReference({ org: "acme", slug: "alpha" }));
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to view identity provider");
    expect(r.checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.identity_provider,
        resourceId: "idp_a",
      },
    ]);
  });

  it("getByReference reads a provider by its id, and never asks the name table about a slug beside it", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "alpha" }));
    await r.store.insert(storedProvider({ id: "idp_b", org: "acme", slug: "beta" }));

    expect((await r.queries.getByReference({ org: "acme", id: "idp_a" })).metadata?.slug).toBe("alpha");
    // "beta" names another provider; beside an id the slug is not looked up.
    expect((await r.queries.getByReference({ org: "acme", id: "idp_a", slug: "beta" })).metadata?.id).toBe("idp_a");
  });

  it("getByReference by id answers a provider of another organization, or none, as missing, and asks for an id or a slug", async () => {
    const r = rig();
    await r.store.insert(storedProvider({ id: "idp_x", org: "other", slug: "x" }));

    const elsewhere = await failure(r.queries.getByReference({ org: "acme", id: "idp_x" }));
    expect(elsewhere.code).toBe(Code.NotFound);
    expect(elsewhere.rawMessage).toBe("IdentityProvider 'acme/idp_x' not found");
    const gone = await failure(r.queries.getByReference({ org: "acme", id: "idp_gone" }));
    expect(gone.rawMessage).toBe("IdentityProvider 'acme/idp_gone' not found");
    // Each miss is answered only after the organization's bar, as a slug's is.
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME, CREATE_IDP_ON_ACME]);

    // An empty reference is the contract's own refusal over the wire, and the
    // step's guard for an in-process caller that skips the contract.
    const nothing = await failure(r.queries.getByReference({ org: "acme" }));
    expect(nothing.code).toBe(Code.InvalidArgument);
    expect(nothing.rawMessage).toBe("a reference names its resource by id or by slug [reference.id_or_slug]");
    const step = newLoadProviderByReferenceStep(inMemoryNames(), r.store, { authorize: async () => ({ kind: "allow" as const }) });
    const inProcess = await failure(
      Promise.resolve(
        step.execute(
          new RequestContext(
            ApiResourceReferenceSchema,
            create(ApiResourceReferenceSchema, { org: "acme" }),
            { identityId: "usr_1", callerClass: "user", issuer: "stigmer", rawToken: "" },
          ),
        ),
      ),
    );
    expect(inProcess.code).toBe(Code.InvalidArgument);
    expect(inProcess.rawMessage).toBe("slug or id is required in reference");
  });

  it("getByReference answers a missing slug NOT_FOUND to the organization's admin, asking only the organization's can_create_idp", async () => {
    const r = rig();
    const unknown = await failure(r.queries.getByReference({ org: "acme", slug: "ops" }));
    expect(unknown.code).toBe(Code.NotFound);
    expect(unknown.rawMessage).toBe("IdentityProvider 'acme/ops' not found");
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME]);
  });

  it.each([
    ["an outsider", () => "deny" as const],
    [
      "a viewer of the organization who is not its admin",
      (check: AuthzCheck) => (check.permission === IamPermission.can_create_idp ? ("deny" as const) : ("allow" as const)),
    ],
  ])("getByReference answers %s get's denial for a missing slug, as for a provider they may not see", async (_who, decide) => {
    const r = rig({ decide });
    const refused = await failure(r.queries.getByReference({ org: "acme", slug: "ops" }));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe("unauthorized to view identity provider");
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME]);
  });

  it.each([
    ["an outsider", () => "deny" as const],
    [
      "a viewer of the organization who is not its admin",
      (check: AuthzCheck) => (check.permission === IamPermission.can_create_idp ? ("deny" as const) : ("allow" as const)),
    ],
  ])("getByReference answers %s get's denial for a missing id, another organization's provider included", async (_who, decide) => {
    const r = rig({ decide });
    await r.store.insert(storedProvider({ id: "idp_x", org: "other", slug: "x" }));

    for (const id of ["idp_x", "idp_gone"]) {
      const refused = await failure(r.queries.getByReference({ org: "acme", id }));
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe("unauthorized to view identity provider");
    }
    expect(r.checks).toEqual([CREATE_IDP_ON_ACME, CREATE_IDP_ON_ACME]);
  });

  it("getByReference answers an outsider the same denial for a provider's id whether the organization holds it, another organization does, or none", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "alpha" }));
    await r.store.insert(storedProvider({ id: "idp_x", org: "other", slug: "x" }));

    for (const id of ["idp_a", "idp_x", "idp_gone"]) {
      const refused = await failure(r.queries.getByReference({ org: "acme", id }));
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe("unauthorized to view identity provider");
    }
    expect(r.checks).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.identity_provider, resourceId: "idp_a" },
      CREATE_IDP_ON_ACME,
      CREATE_IDP_ON_ACME,
    ]);
  });

  it("list offers the organization's rows newest first and answers only what the scope allows", async () => {
    const r = rig({ listable: (id) => id !== "idp_b" });
    await r.store.insert(storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" }));
    await r.store.insert(storedProvider({ id: "idp_x", org: "other", slug: "x" }));
    await r.store.insert(storedProvider({ id: "idp_b", org: "acme", slug: "idp-b" }));
    await r.store.insert(storedProvider({ id: "idp_c", org: "acme", slug: "c" }));

    const listed = await r.queries.list({ org: "acme" });
    expect(listed.entries.map((row) => row.metadata?.id)).toEqual(["idp_c", "idp_a"]);
    expect(r.offered.map((entries) => entries.map((e) => e.id))).toEqual([["idp_c", "idp_b", "idp_a"]]);
    expect(r.checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  /** Seeds `count` of acme's providers a minute apart; their ids, newest first. */
  async function seedProviders(r: ReturnType<typeof rig>, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `idp_${String(i).padStart(3, "0")}`;
      await r.store.insert(
        storedProvider({ id, org: "acme", slug: `idp-${i}`, createdAt: new Date(Date.UTC(2026, 8, 25, 10, i)) }),
      );
      ids.push(id);
    }
    return ids.reverse();
  }

  it("list answers a page and a token that continues it, newest first, to the end", async () => {
    const r = rig();
    const newestFirst = await seedProviders(r, 5);
    const read: string[] = [];
    const tokens: string[] = [];
    let pageToken = "";
    do {
      const page = await r.queries.list({ org: "acme", pageSize: 2, pageToken });
      read.push(...page.entries.map((row) => row.metadata?.id ?? ""));
      pageToken = page.nextPageToken;
      tokens.push(pageToken);
    } while (pageToken !== "");
    expect(read).toEqual(newestFirst);
    expect(tokens.map((token) => token !== "")).toEqual([true, true, false]);
  });

  it("list answers the default page of 50 and a token at size 0, never every provider", async () => {
    const r = rig();
    const newestFirst = await seedProviders(r, 55);
    const first = await r.queries.list({ org: "acme", pageSize: 0, pageToken: "" });
    expect(first.entries.map((row) => row.metadata?.id)).toEqual(newestFirst.slice(0, 50));
    const rest = await r.queries.list({ org: "acme", pageSize: 0, pageToken: first.nextPageToken });
    expect(rest.entries.map((row) => row.metadata?.id)).toEqual(newestFirst.slice(50));
    expect(rest.nextPageToken).toBe("");
  });

  it("list refuses a token issued for another organization's list", async () => {
    const r = rig();
    await seedProviders(r, 3);
    const { nextPageToken } = await r.queries.list({ org: "acme", pageSize: 1, pageToken: "" });
    const error = await failure(r.queries.list({ org: "globex", pageSize: 1, pageToken: nextPageToken }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("page_token was issued for a different request");
  });
});

describe("a provider whose delete did not finish", () => {
  it("answers a caller who may not edit it exactly as on a live provider, so only an editor learns of the delete", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.insert(storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform" }));
    const onLive = await failure(r.commands.update({ resource: provider({}, { id: "idp_held" }), updateMask: { paths: ["*"] } }));
    const applyOnLive = await failure(r.commands.apply(provider({})));

    await r.store.markDeleting("idp_held");
    const onMarked = await failure(r.commands.update({ resource: provider({}, { id: "idp_held" }), updateMask: { paths: ["*"] } }));
    const applyOnMarked = await failure(r.commands.apply(provider({})));

    expect([onMarked.code, onMarked.rawMessage]).toEqual([onLive.code, onLive.rawMessage]);
    expect([applyOnMarked.code, applyOnMarked.rawMessage]).toEqual([applyOnLive.code, applyOnLive.rawMessage]);
    expect(onMarked.rawMessage).not.toBe(PROVIDER_BEING_DELETED_MESSAGE);
    expect(applyOnMarked.rawMessage).not.toBe(PROVIDER_BEING_DELETED_MESSAGE);
  });

  it("refuses an update and an apply of a provider whose delete did not finish, and changes nothing", async () => {
    const r = rig();
    const stored = storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform" });
    await r.store.insert(stored);
    await r.store.markDeleting("idp_held");

    const throughUpdate = await failure(r.commands.update({ resource: provider({}, { id: "idp_held" }), updateMask: { paths: ["*"] } }));
    expect(throughUpdate.code).toBe(Code.FailedPrecondition);
    expect(throughUpdate.rawMessage).toBe(PROVIDER_BEING_DELETED_MESSAGE);

    const throughApply = await failure(r.commands.apply(provider({})));
    expect(throughApply.code).toBe(Code.FailedPrecondition);
    expect(throughApply.rawMessage).toBe(PROVIDER_BEING_DELETED_MESSAGE);

    expect(await r.store.findById("idp_held")).toEqual(stored);
    expect(r.dialed, "refused before anything is dialed").toEqual([]);
    expect(r.invalidations).toBe(0);
  });

  it("answers NOT_FOUND to an update whose provider's delete finished between its two reads", async () => {
    /** A store whose delete finishes exactly while the update asks whether the provider is live. */
    class DeletedWhileAsked extends InMemoryProviderStore {
      override async isLive(id: string): Promise<boolean> {
        await this.deleteById(id);
        return false;
      }
    }
    const store = new DeletedWhileAsked();
    const r = rig({ store });
    await store.insert(storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform" }));

    const refused = await failure(r.commands.update({ resource: provider({}, { id: "idp_held" }), updateMask: { paths: ["*"] } }));
    expect(refused.code).toBe(Code.NotFound);
  });

});

describe("the issuer's endpoints on save, through the egress guard", () => {
  it("creates a provider whose issuer's document names its JWKS, which serves keys", async () => {
    const r = rig();
    const created = await r.commands.create(provider({ userinfoEndpoint: USERINFO }));
    expect(created.metadata?.id).toMatch(/^idp_/);
    expect(r.dialed).toEqual([DISCOVERY, JWKS]);
    expect(r.store.size).toBe(1);
  });

  it.each([
    ["a loopback literal", "https://127.0.0.1", undefined],
    ["the link-local metadata address", "https://169.254.169.254", undefined],
    ["a name resolving to a private address", "https://jwks.internal.test", "10.0.0.5"],
    ["a name with one public and one private record", "https://mixed.acme.test", "10.0.0.6"],
  ])("refuses an issuer at %s without dialing it or writing a row", async (_case, issuer, resolved) => {
    const r = rig();
    const error = await failure(r.commands.create(provider({ issuers: [issuer] })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      `The discovery document of issuer '${issuer}' is not at an address this platform can reach.`,
    );
    if (resolved !== undefined) {
      expect(error.rawMessage).not.toContain(resolved);
    }
    expect(r.dialed).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  it("refuses a JWKS the document names at an internal host, without its resolved address", async () => {
    const internal = "https://jwks.internal.test/keys";
    const r = rig({ answers: { [DISCOVERY]: discoveryDocument("https://idp.acme.test", { jwksUri: internal }) } });
    const error = await failure(r.commands.create(provider({ jwksUri: internal })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(`JWKS URI is not an address this platform can reach: ${internal}`);
    expect(r.dialed).toEqual([DISCOVERY]);
    expect(r.store.size).toBe(0);
  });

  it("refuses a public JWKS that redirects to an internal one, on the hop", async () => {
    const hop = "https://idp.acme.test/jwks";
    const r = rig({
      answers: {
        [DISCOVERY]: discoveryDocument("https://idp.acme.test", { jwksUri: hop }),
        [hop]: () =>
          new Response(null, { status: 302, headers: { location: "https://jwks.internal.test/keys" } }),
      },
    });
    const error = await failure(r.commands.create(provider({ jwksUri: hop })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(`JWKS URI is not an address this platform can reach: ${hop}`);
    expect(r.dialed).toEqual([DISCOVERY, hop]);
    expect(r.store.size).toBe(0);
  });

  it("answers an issuer whose name does not resolve exactly as one the policy refuses", async () => {
    const copies = await Promise.all(
      ["https://nowhere.acme.test", "https://jwks.internal.test"].map(async (issuer) => {
        const r = rig();
        const error = await failure(r.commands.create(provider({ issuers: [issuer] })));
        expect(error.code).toBe(Code.InvalidArgument);
        expect(r.dialed).toEqual([]);
        return error.rawMessage.replace(issuer, "<issuer>");
      }),
    );
    expect(copies).toEqual([
      "The discovery document of issuer '<issuer>' is not at an address this platform can reach.",
      "The discovery document of issuer '<issuer>' is not at an address this platform can reach.",
    ]);
  });

  it("answers a JWKS whose name does not resolve exactly as one the policy refuses", async () => {
    const copies = await Promise.all(
      ["https://nowhere.acme.test/keys", "https://jwks.internal.test/keys"].map(async (jwksUri) => {
        const r = rig({ answers: { [DISCOVERY]: discoveryDocument("https://idp.acme.test", { jwksUri }) } });
        const error = await failure(r.commands.create(provider({ jwksUri })));
        expect(error.code).toBe(Code.InvalidArgument);
        expect(r.dialed).toEqual([DISCOVERY]);
        return error.rawMessage.replace(jwksUri, "<jwks>");
      }),
    );
    expect(copies).toEqual([
      "JWKS URI is not an address this platform can reach: <jwks>",
      "JWKS URI is not an address this platform can reach: <jwks>",
    ]);
  });

  it("says a public JWKS cannot be reached without the fetch's cause", async () => {
    const unreachable = "https://idp.acme.test/jwks";
    const r = rig({ answers: { [DISCOVERY]: discoveryDocument("https://idp.acme.test", { jwksUri: unreachable }) } });
    const error = await failure(r.commands.create(provider({ jwksUri: unreachable })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(`JWKS URI is not reachable: ${unreachable}`);
  });
});

describe("the discovery binding", () => {
  it.each([
    [
      "an issuer that is not HTTPS",
      { issuers: ["http://idp.acme.test"] },
      {},
      "Issuer must use HTTPS: http://idp.acme.test",
    ],
    [
      "an issuer that publishes no document",
      { issuers: ["https://nodoc.acme.test"] },
      {},
      "The discovery document of issuer 'https://nodoc.acme.test' is not reachable: " +
        "https://nodoc.acme.test/.well-known/openid-configuration",
    ],
    [
      "a document that answers an error status",
      {},
      { [DISCOVERY]: () => new Response("missing", { status: 404 }) },
      `The discovery document of issuer 'https://idp.acme.test' answered HTTP 404. Every issuer must publish one at ${DISCOVERY}`,
    ],
    [
      "a document that is not JSON",
      {},
      { [DISCOVERY]: () => new Response("<html>") },
      `The discovery document of issuer 'https://idp.acme.test' is not a JSON document: ${DISCOVERY}`,
    ],
    [
      "a document that names another issuer",
      {},
      { [DISCOVERY]: discoveryDocument("https://idp.acme.test", { issuerAs: "https://evil.test/" }) },
      "The discovery document of issuer 'https://idp.acme.test' names another issuer, 'https://evil.test/'. " +
        "Name the issuer its own document publishes.",
    ],
    [
      "a jwks_uri other than the document's",
      { jwksUri: "https://keys.elsewhere.test/jwks" },
      {},
      `jwks_uri must be the key set issuer 'https://idp.acme.test' publishes in its discovery document: ${JWKS}`,
    ],
    [
      "a userinfo_endpoint other than the document's",
      { userinfoEndpoint: "https://profiles.elsewhere.test/me" },
      {},
      `userinfo_endpoint must be the one issuer 'https://idp.acme.test' publishes in its discovery document: ${USERINFO}`,
    ],
    [
      "an audience that is a URL the document names",
      { audience: USERINFO },
      {},
      `expected_audience '${USERINFO}' is a URL the discovery document of issuer 'https://idp.acme.test' names, ` +
        "which the issuer may add to every token it mints. Use the API identifier or client ID your " +
        "organization registered for Stigmer at this issuer.",
    ],
  ])("refuses %s, writing nothing", async (_case, spec, answers, copy) => {
    const r = rig({ answers });
    const error = await failure(r.commands.create(provider(spec)));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
    expect(r.store.size).toBe(0);
  });

  it("refuses the host's own sign-in issuer before anything is dialed", async () => {
    const r = rig({ reservedIssuers: ["https://idp.acme.test/"] });
    const error = await failure(r.commands.create(provider()));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      "Issuer 'https://idp.acme.test' is this platform's own sign-in issuer and cannot be an " +
        "organization's identity provider.",
    );
    expect(r.dialed).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  it("refuses a provider without an audience, or naming an issuer without a jwks_uri, by the contract's rules", async () => {
    const r = rig();
    const noAudience = await failure(r.commands.create(provider({ audience: "" })));
    expect(noAudience.code).toBe(Code.InvalidArgument);
    expect(noAudience.rawMessage).toContain("spec.expected_audience");
    const noKeys = await failure(r.commands.create(provider({ jwksUri: "" })));
    expect(noKeys.code).toBe(Code.InvalidArgument);
    expect(noKeys.rawMessage).toContain("identity_provider.jwks_uri_required_with_issuers");
    expect(r.dialed).toEqual([]);
    expect(r.store.size).toBe(0);
  });
});

describe("userinfo_endpoint on save", () => {
  it.each([
    ["plain HTTP", "http://idp.acme.test/userinfo", "UserInfo endpoint must use HTTPS: http://idp.acme.test/userinfo"],
    ["not a URL", "idp.acme.test/userinfo", "UserInfo endpoint is not a valid URL: idp.acme.test/userinfo"],
  ])("refuses %s before anything is dialed", async (_case, userinfoEndpoint, copy) => {
    const r = rig();
    const error = await failure(r.commands.create(provider({ userinfoEndpoint })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
    expect(r.dialed).toEqual([]);
    expect(r.store.size).toBe(0);
  });
});

/**
 * The contract's refusal of an owner sign-in role, as ValidateProto answers
 * it (`identity_provider.sign_in_role_not_owner` on IdentityProviderSpec,
 * the path its violation names, then its id).
 */
const OWNER_SIGN_IN_ROLE_REFUSED =
  "spec: sign_in_role cannot be owner; organization ownership must be assigned explicitly " +
  "[identity_provider.sign_in_role_not_owner]";

/** The sign-in fields a request may carry, set on a provider the builder made. */
function withSignIn(
  message: IdentityProvider,
  signIn: {
    createAccountsOnSignIn?: boolean;
    signInRole?: IamRole;
    externalIdClaim?: string;
  },
): IdentityProvider {
  const spec = message.spec;
  if (spec === undefined) {
    throw new Error("the builder always sets a spec");
  }
  spec.createAccountsOnSignIn = signIn.createAccountsOnSignIn ?? false;
  spec.signInRole = signIn.signInRole ?? IamRole.iam_role_unspecified;
  spec.externalIdClaim = signIn.externalIdClaim ?? "";
  return message;
}

describe("the sign-in fields on save", () => {
  const OWNER_GRANT = {
    createAccountsOnSignIn: true,
    signInRole: IamRole.owner,
  };

  it.each([
    ["an owner sign-in role", withSignIn(provider({}), OWNER_GRANT), OWNER_SIGN_IN_ROLE_REFUSED],
  ])("refuses %s on create, before anything is dialed", async (_case, message, copy) => {
    const r = rig();
    const error = await failure(r.commands.create(message));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
    expect(r.dialed).toEqual([]);
    expect(r.store.size).toBe(0);
    expect(r.created).toEqual([]);
  });

  it.each([
    ["participant", IamRole.participant],
    ["editor", IamRole.editor],
    ["user", IamRole.user],
  ])("refuses a %s sign-in role, which no organization grants, on create and on update, before anything is dialed", async (name, role) => {
    const copy =
      `sign_in_role '${name}' cannot be granted on an organization; set one of 'admin', 'member', 'viewer', ` +
      "or leave it unset to grant nothing.";
    const r = rig();
    const created = await failure(
      r.commands.create(withSignIn(provider({}), { createAccountsOnSignIn: true, signInRole: role })),
    );
    expect(created.code).toBe(Code.InvalidArgument);
    expect(created.rawMessage).toBe(copy);
    expect(r.store.size).toBe(0);

    const stored = storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" });
    await r.store.insert(stored);
    const updated = await failure(
      r.commands.update(
        { resource: withSignIn(provider({}, { id: "idp_a" }), { createAccountsOnSignIn: true, signInRole: role }), updateMask: { paths: ["*"] } },
      ),
    );
    expect(updated.code).toBe(Code.InvalidArgument);
    expect(updated.rawMessage).toBe(copy);
    expect(await r.store.findById("idp_a")).toEqual(stored);
    expect(r.dialed).toEqual([]);
  });

  it("admits every sign-in role an organization grants but owner", async () => {
    for (const role of [IamRole.admin, IamRole.member, IamRole.viewer]) {
      const created = await rig().commands.create(
        withSignIn(provider({}), { createAccountsOnSignIn: true, signInRole: role }),
      );
      expect(created.spec?.signInRole).toBe(role);
    }
  });

  it("accepts an external id claim that grants nothing: binding without granting", async () => {
    const r = rig();
    const created = await r.commands.create(withSignIn(provider(), { externalIdClaim: "org_id" }));
    expect(created.spec?.externalIdClaim).toBe("org_id");
    expect(created.spec?.signInRole).toBe(IamRole.iam_role_unspecified);
  });

  it("refuses an external id claim on a provider of a child organization, which has no children to route to", async () => {
    const r = rig({ parents: new Map([["acme", "org_parent"]]) });
    const error = await failure(
      r.commands.create(withSignIn(provider(), { externalIdClaim: "org_id" })),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "external_id_claim cannot be set on an identity provider of a child organization: a child " +
        "organization has no child organizations to route a sign-in to.",
    );
    expect(r.store.size).toBe(0);
    // The same organization's provider with no claim is admitted.
    await r.commands.create(provider());
  });

  it("refuses an owner sign-in role on update and leaves the stored row as it was", async () => {
    const r = rig();
    const stored = storedProvider({ id: "idp_a", org: "acme", slug: "idp-a" });
    await r.store.insert(stored);

    const error = await failure(
      r.commands.update({ resource: withSignIn(provider({}, { id: "idp_a" }), OWNER_GRANT), updateMask: { paths: ["*"] } }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(OWNER_SIGN_IN_ROLE_REFUSED);
    expect(await r.store.findById("idp_a")).toEqual(stored);
    expect(r.dialed).toEqual([]);
    expect(r.invalidations).toBe(0);
  });

  it("refuses an owner sign-in role through both apply doors", async () => {
    const r = rig();
    const throughCreate = await failure(
      r.commands.apply(withSignIn(provider({}), OWNER_GRANT)),
    );
    expect(throughCreate.code).toBe(Code.InvalidArgument);
    expect(throughCreate.rawMessage).toBe(OWNER_SIGN_IN_ROLE_REFUSED);
    expect(r.store.size).toBe(0);

    const stored = storedProvider({ id: "idp_held", org: "acme", slug: "acme-platform" });
    await r.store.insert(stored);
    const throughUpdate = await failure(
      r.commands.apply(withSignIn(provider({}), OWNER_GRANT)),
    );
    expect(throughUpdate.code).toBe(Code.InvalidArgument);
    expect(throughUpdate.rawMessage).toBe(OWNER_SIGN_IN_ROLE_REFUSED);
    expect(await r.store.findById("idp_held")).toEqual(stored);
  });

  it.each([
    ["admin", IamRole.admin],
    ["member", IamRole.member],
    ["viewer", IamRole.viewer],
  ])("accepts a sign-in role of %s", async (_role, signInRole) => {
    const r = rig();
    const created = await r.commands.create(
      withSignIn(provider(), { createAccountsOnSignIn: true, signInRole }),
    );
    expect(created.spec?.signInRole).toBe(signInRole);
    expect(r.store.size).toBe(1);
  });
});
