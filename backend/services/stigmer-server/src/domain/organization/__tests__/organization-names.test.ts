/**
 * Pins an organization's names (names.ts, rename.ts) through a composed
 * server in the trusted-local posture:
 *
 *   - a create mints an `org_` id, its slug resolves to it, and an
 *     organization naming an organization of its own is refused;
 *   - of two concurrent creates of one slug exactly one succeeds;
 *   - a create racing another create's young claim is a duplicate, while a
 *     claim older than a minute whose organization never landed is freed;
 *   - a pre-side-effect gate's refusal leaves no claim, and a create that
 *     fails after its row is stored keeps its name;
 *   - a delete releases the slug, and the next organization of that slug
 *     is a different organization;
 *   - a rename keeps the organization's id, leaves the old slug leading to
 *     it and refused to others, takes back its own old slug, is refused a
 *     slug another organization holds, and changes nothing when the slug is
 *     already its own; get, apply and update find a renamed organization by
 *     its old slug, and an apply carrying the id leaves the slug to rename.
 *
 * And, over store doubles, the two failure paths: the release a failed
 * create runs (it frees the claim only when the organization was never
 * stored, and every fault leaves the name claimed), and the move back a
 * rename whose row write fails runs. Also over doubles, the arms a composed
 * server does not reach in order: when a name's holder counts as gone, the
 * claim and release steps' server faults, and the organization loaders'
 * answers for an id or slug no row holds and for a store fault.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import type { GateSlotName } from "../../../extensions/gate-slots.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameRename,
  Store,
} from "../../../store/interface.js";
import { fakeIamPolicyStore } from "../../iampolicy/__tests__/support.js";
import {
  ABANDONED_NAME_AFTER_MS,
  ORGANIZATION_SLUG_RESERVED,
  RENAMED_SLUG_HOLD_MS,
  nameHolderIsGone,
  newClaimOrganizationSlugStep,
  organizationIdReservedMessage,
  settleOrganizationSlug,
  newRetireOrganizationSlugStep,
  organizationNameKey,
  releaseSlugClaimAfterFailure,
} from "../names.js";
import {
  RENAMED_ORGANIZATION_KEY,
  newPersistRenamedOrganizationStep,
  newRenameOrganizationSlugStep,
} from "../rename.js";
import {
  newLoadExistingOrganizationStep,
  newLoadOrganizationForApplyStep,
} from "../steps.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  EXISTS_IN_DATABASE_KEY,
  SHOULD_CREATE_KEY,
} from "../../../pipeline/steps/load-for-apply.js";

const OPERATOR_EMAIL = "operator@example.com";
const DUPLICATE_COPY = (slug: string) =>
  `Organization already exists: slug '${slug}'`;
const MINTED_ID = /^org_[0-9a-z]{26}$/;

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: "created by the organization names test" },
  };
}

function reasonOf(error: ConnectError): string | undefined {
  return error.findDetails(ErrorInfoSchema)[0]?.reason;
}

describe("organization names (composed server, trusted-local posture)", () => {
  const policies = fakeIamPolicyStore();
  /** Slugs the pre-side-effect gate refuses while listed. */
  const gateRefuses = new Set<string>();
  /** Slugs whose post-persist step fails, after the row is stored. */
  const postPersistFails = new Set<string>();

  const slugOf = (organization: Organization) =>
    organization.metadata?.slug ?? "";
  const gateStep: PipelineStep<DescMessage> = {
    name: "FakeOrgLimitGate",
    execute: (ctx) => {
      if (gateRefuses.has(slugOf(ctx.newState as Organization))) {
        throw new ConnectError(
          "fake limit on organizations",
          Code.FailedPrecondition,
        );
      }
    },
  };
  const postPersistStep: PipelineStep<DescMessage> = {
    name: "FakeOrgPostPersist",
    execute: (ctx) => {
      if (postPersistFails.has(slugOf(ctx.newState as Organization))) {
        throw new ConnectError("fake companion failed", Code.Unavailable);
      }
    },
  };
  const unit: ServerExtension = {
    name: "fake-org-create",
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["org-create:pre-side-effect-gate", [gateStep]],
      ["org-create:post-persist", [postPersistStep]],
    ]),
    drivers: { iamPolicyStore: policies },
  };

  let dir: string;
  let server: ComposedServer;
  let organizations: Client<typeof OrganizationCommandController>;
  let organizationQuery: Client<typeof OrganizationQueryController>;

  const resolve = (slug: string) =>
    server.store.resourceNames.resolve(
      organizationNameKey(slug),
      new Date().toISOString(),
    );
  const ownersOf = (org: string) =>
    [...policies.rows.values()].filter(
      (policy) =>
        policy.spec?.resource?.kind === "organization" &&
        policy.spec.resource.id === org &&
        policy.spec.relation === "owner",
    ).length;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-names-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    organizations = createClient(OrganizationCommandController, transport);
    organizationQuery = createClient(OrganizationQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    gateRefuses.clear();
    postPersistFails.clear();
  });

  it("a create mints an org_ id, and its slug resolves to it", async () => {
    const created = await organizations.create(organizationInput("minted"));
    const id = created.metadata?.id ?? "";
    expect(id).toMatch(MINTED_ID);
    expect(created.metadata?.slug).toBe("minted");
    expect(created.metadata?.org).toBe("");
    expect((await resolve("minted"))?.id).toBe(id);
    expect(
      (await organizationQuery.get({ value: "minted" })).metadata?.id,
      "get by slug resolves to the organization",
    ).toBe(id);
  });

  it("an organization that names an organization of its own is refused", async () => {
    const refusal = await grpcError(() =>
      organizations.create({
        ...organizationInput("nested"),
        metadata: { name: "nested", slug: "nested", org: "minted" },
      }),
    );
    expect(refusal.code).toBe(Code.InvalidArgument);
    expect(refusal.rawMessage).toMatch(/belongs to no organization/);
    expect(await resolve("nested")).toBeUndefined();
  });

  it("an organization naming itself, as earlier releases stored it, is cleared rather than refused", async () => {
    // A create from a client of that time sends its own slug as its org.
    const made = await organizations.create({
      ...organizationInput("selfnamed"),
      metadata: { name: "selfnamed", slug: "selfnamed", org: "selfnamed" },
    });
    expect(made.metadata?.org).toBe("");

    // An organization an earlier release made stores its slug, its id, as
    // its org; applying its own `get -o yaml` back succeeds, and the row
    // keeps what it holds.
    await server.store.saveResource(
      ApiResourceKind.organization,
      "olden",
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: "olden", slug: "olden", name: "Olden", org: "olden" },
      }),
    );
    await server.store.resourceNames.claim(organizationNameKey("olden"), "olden", new Date().toISOString());
    const applied = await organizations.apply({
      ...organizationInput("olden"),
      metadata: { id: "olden", name: "Olden", slug: "olden", org: "olden" },
      spec: { description: "applied back from its own manifest" },
    });
    expect(applied.metadata?.id).toBe("olden");
    expect(applied.spec?.description).toBe("applied back from its own manifest");

    // An apply naming a minted organization by slug alone, with its own slug
    // as its org (as earlier CLIs injected it): the edge turns that org into
    // the id, which is the id the slug resolves to.
    const reapplied = await organizations.apply({
      ...organizationInput("selfnamed"),
      metadata: { name: "selfnamed", slug: "selfnamed", org: "selfnamed" },
      spec: { description: "applied by slug alone" },
    });
    expect(reapplied.metadata?.id).toBe(made.metadata?.id);
    expect(reapplied.spec?.description).toBe("applied by slug alone");
  });

  it("an update that lands after its names moved on writes the row with the current name", async () => {
    const made = await organizations.create(organizationInput("settle-a"));
    const id = made.metadata?.id ?? "";
    // A rename's names land, and its row write has not yet: the row still
    // says settle-a while the table says settle-b.
    const now = new Date().toISOString();
    await server.store.resourceNames.rename({
      ...organizationNameKey("settle-a"),
      id,
      from: "settle-a",
      to: "settle-b",
      fromExpiresAt: new Date(Date.now() + RENAMED_SLUG_HOLD_MS).toISOString(),
      now,
    });

    const updated = await organizations.update({
      ...organizationInput("settle-a"),
      metadata: { id, name: "settle-a", slug: "settle-a" },
      spec: { description: "an update that copied the slug it loaded" },
    });
    expect(updated.metadata?.slug).toBe("settle-b");
    const stored = await server.store.getResource(ApiResourceKind.organization, id, OrganizationSchema);
    expect(stored.metadata?.slug).toBe("settle-b");
    expect(stored.spec?.description).toBe("an update that copied the slug it loaded");
  });

  it("deleting an organization from an earlier release keeps its slug, its id, reserved", async () => {
    await server.store.saveResource(
      ApiResourceKind.organization,
      "veteran",
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: "veteran", slug: "veteran", name: "Veteran" },
      }),
    );
    await server.store.resourceNames.claim(organizationNameKey("veteran"), "veteran", new Date().toISOString());
    await organizations.delete({ value: "veteran" });

    const refused = await grpcError(() => organizations.create(organizationInput("veteran")));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(reasonOf(refused)).toBe(ORGANIZATION_SLUG_RESERVED);
    expect(refused.rawMessage).toBe(organizationIdReservedMessage("veteran"));
  });

  it("of two concurrent creates of one slug, exactly one succeeds and the other is a duplicate", async () => {
    const results = await Promise.allSettled([
      organizations.create(organizationInput("contended")),
      organizations.create(organizationInput("contended")),
    ]);
    const made = results.filter(
      (result): result is PromiseFulfilledResult<Organization> =>
        result.status === "fulfilled",
    );
    expect(made).toHaveLength(1);
    const [rejected] = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const refusal = ConnectError.from(rejected?.reason);
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe(DUPLICATE_COPY("contended"));
    expect(ownersOf(made[0]!.value.metadata?.id ?? "")).toBe(1);
  });

  it("a create racing another create's young claim is a duplicate; an abandoned claim is freed", async () => {
    await server.store.resourceNames.claim(
      organizationNameKey("in-flight"),
      "org_00000000000000000000000000",
      new Date().toISOString(),
    );
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("in-flight")),
    );
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe(DUPLICATE_COPY("in-flight"));

    await server.store.resourceNames.claim(
      organizationNameKey("abandoned"),
      "org_11111111111111111111111111",
      new Date(Date.now() - ABANDONED_NAME_AFTER_MS - 1000).toISOString(),
    );
    const made = await organizations.create(organizationInput("abandoned"));
    expect(made.metadata?.id).toMatch(MINTED_ID);
    expect((await resolve("abandoned"))?.id).toBe(made.metadata?.id);
  });

  it("a pre-side-effect gate's refusal leaves no claim, so the create succeeds once the gate lets it", async () => {
    gateRefuses.add("gated");
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("gated")),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(await resolve("gated")).toBeUndefined();

    gateRefuses.delete("gated");
    const created = await organizations.create(organizationInput("gated"));
    expect(created.metadata?.id).toMatch(MINTED_ID);
  });

  it("a create that fails after its row is stored keeps its name", async () => {
    postPersistFails.add("half-made");
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("half-made")),
    );
    expect(refusal.code).toBe(Code.Unavailable);

    const id = (await resolve("half-made"))?.id ?? "";
    expect(id).toMatch(MINTED_ID);
    expect(
      (await organizationQuery.get({ value: "half-made" })).metadata?.id,
    ).toBe(id);

    postPersistFails.delete("half-made");
    const retry = await grpcError(() =>
      organizations.create(organizationInput("half-made")),
    );
    expect(retry.code).toBe(Code.AlreadyExists);
    expect(retry.rawMessage).toBe(DUPLICATE_COPY("half-made"));
  });

  it("a delete releases the slug, and the next organization of that slug is a different one", async () => {
    const first = await organizations.create(organizationInput("reused"));
    await organizations.delete({ value: "reused" });
    expect(await resolve("reused")).toBeUndefined();

    const second = await organizations.create(organizationInput("reused"));
    expect(second.metadata?.id).toMatch(MINTED_ID);
    expect(second.metadata?.id).not.toBe(first.metadata?.id);
  });

  it("a rename keeps the id; the old slug leads to the organization and is refused to others until it expires", async () => {
    const made = await organizations.create(organizationInput("acme"));
    const id = made.metadata?.id ?? "";

    const renamed = await organizations.rename(
      create(RenameInputSchema, { resourceId: "acme", slug: "acme-corp" }),
    );
    expect(renamed.metadata?.id).toBe(id);
    expect(renamed.metadata?.slug).toBe("acme-corp");
    expect(renamed.status?.audit?.specAudit?.event).toBe("renamed");

    expect((await organizationQuery.get({ value: "acme" })).metadata?.id).toBe(id);
    expect((await organizationQuery.get({ value: "acme-corp" })).metadata?.slug).toBe(
      "acme-corp",
    );
    const old = await resolve("acme");
    expect(old?.state).toBe("previous");
    const held = Date.parse(old?.expiresAt ?? "") - Date.now();
    expect(held).toBeGreaterThan(RENAMED_SLUG_HOLD_MS - 60_000);
    expect(held).toBeLessThanOrEqual(RENAMED_SLUG_HOLD_MS);

    const taken = await grpcError(() =>
      organizations.create(organizationInput("acme")),
    );
    expect(taken.code).toBe(Code.AlreadyExists);
    expect(reasonOf(taken)).toBe(ORGANIZATION_SLUG_RESERVED);
  });

  it("an organization from an earlier release keeps its old slug, its id, for good after a rename; a minted one's lapses", async () => {
    // An earlier release filed the organization under its slug: id == slug,
    // and the migration recorded that slug as its current name.
    const seededAt = new Date().toISOString();
    await server.store.saveResource(
      ApiResourceKind.organization,
      "wayne",
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: "wayne", slug: "wayne", name: "Wayne" },
      }),
    );
    expect(
      (await server.store.resourceNames.claim(organizationNameKey("wayne"), "wayne", seededAt)).claimed,
    ).toBe(true);
    const minted = await organizations.create(organizationInput("stark"));

    await organizations.rename(create(RenameInputSchema, { resourceId: "wayne", slug: "wayne-corp" }));
    await organizations.rename(create(RenameInputSchema, { resourceId: "stark", slug: "stark-industries" }));

    const kept = await resolve("wayne");
    expect(kept).toMatchObject({ id: "wayne", state: "previous", expiresAt: "" });

    // Past the hold, the old slug still names the earlier release's
    // organization, so every row filed under it keeps resolving, and nobody
    // else can take it; the minted organization's old slug is free.
    const pastTheHold = new Date(Date.now() + RENAMED_SLUG_HOLD_MS + 86_400_000).toISOString();
    expect(
      (await server.store.resourceNames.resolve(organizationNameKey("wayne"), pastTheHold))?.id,
    ).toBe("wayne");
    const contested = await server.store.resourceNames.claim(
      organizationNameKey("wayne"),
      "org_01jzzzzzzzzzzzzzzzzzzzzzzz",
      pastTheHold,
    );
    expect(contested.claimed).toBe(false);
    expect(contested.entry.id).toBe("wayne");
    expect(
      await server.store.resourceNames.resolve(organizationNameKey("stark"), pastTheHold),
    ).toBeUndefined();
    expect(minted.metadata?.id).toMatch(MINTED_ID);
  });

  it("a rename takes back its own old slug, is refused another's slug, and changes nothing for its own", async () => {
    const made = await organizations.create(organizationInput("initech"));
    await organizations.create(organizationInput("umbrella"));
    await organizations.rename(
      create(RenameInputSchema, { resourceId: made.metadata?.id, slug: "initech-co" }),
    );

    const back = await organizations.rename(
      create(RenameInputSchema, { resourceId: made.metadata?.id, slug: "initech" }),
    );
    expect(back.metadata?.slug).toBe("initech");
    expect((await resolve("initech"))?.state).toBe("current");

    const refusal = await grpcError(() =>
      organizations.rename(
        create(RenameInputSchema, { resourceId: made.metadata?.id, slug: "umbrella" }),
      ),
    );
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe(DUPLICATE_COPY("umbrella"));

    const same = await organizations.rename(
      create(RenameInputSchema, { resourceId: made.metadata?.id, slug: "initech" }),
    );
    expect(same.metadata?.slug).toBe("initech");
  });

  it("apply and update find a renamed organization by its old slug; an apply carrying the id keeps the slug", async () => {
    const made = await organizations.create(organizationInput("hooli"));
    const id = made.metadata?.id ?? "";
    await organizations.rename(
      create(RenameInputSchema, { resourceId: id, slug: "hooli-xyz" }),
    );

    const applied = await organizations.apply({
      ...organizationInput("hooli"),
      spec: { description: "applied by the old slug" },
    });
    expect(applied.metadata?.id).toBe(id);
    expect(applied.metadata?.slug).toBe("hooli-xyz");

    const withId = await organizations.apply({
      ...organizationInput("hooli-new"),
      metadata: { name: "hooli", slug: "hooli-new", id, org: "" },
    });
    expect(withId.metadata?.id).toBe(id);
    expect(withId.metadata?.slug, "an apply never renames").toBe("hooli-xyz");
    expect(await resolve("hooli-new")).toBeUndefined();

    const updated = await organizations.update({
      ...organizationInput("hooli"),
      spec: { description: "updated by the old slug" },
    });
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.description).toBe("updated by the old slug");
  });
});

describe("releaseSlugClaimAfterFailure", () => {
  const entry: ResourceNameEntry = {
    ...organizationNameKey("acme"),
    id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
    state: "current",
    claimedAt: "2026-09-28T00:00:00.000Z",
    expiresAt: "",
  };

  function logger(): Logger & { errors: string[] } {
    const errors: string[] = [];
    return {
      errors,
      error: (message: string) => errors.push(message),
      warn: () => {},
      info: () => {},
      debug: () => {},
    } as unknown as Logger & { errors: string[] };
  }

  /** A store double: the organization row's read and the name table's claim and release. */
  function storeWith(
    rowRead: () => Promise<unknown>,
    release: (kind: string, org: string, id: string) => Promise<void>,
  ): Store {
    return {
      getResource: rowRead,
      resourceNames: {
        claim: async () => ({ claimed: true, entry }),
        release,
      },
    } as unknown as Store;
  }

  /** A request whose ClaimOrganizationSlug won `entry`. */
  async function claimedRequest(): Promise<
    RequestContext<typeof OrganizationSchema>
  > {
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { slug: "acme", id: entry.id },
      }),
      testCallerIdentity(),
    );
    const claiming = {
      resourceNames: { claim: async () => ({ claimed: true, entry }) },
    } as unknown as Store;
    await newClaimOrganizationSlugStep(claiming).execute(ctx);
    return ctx;
  }

  it("frees the claim when the organization was never stored", async () => {
    const release = vi.fn(async () => {});
    const store = storeWith(async () => {
      throw new ResourceNotFoundError("organization acme");
    }, release);

    await releaseSlugClaimAfterFailure(store, logger(), await claimedRequest());
    expect(release).toHaveBeenCalledWith("organization", "", entry.id);
  });

  it("keeps the claim when the organization was stored", async () => {
    const release = vi.fn(async () => {});
    await releaseSlugClaimAfterFailure(
      storeWith(async () => ({}), release),
      logger(),
      await claimedRequest(),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps the claim, and logs, when the row cannot be read or the release faults", async () => {
    const release = vi.fn(async () => {});
    const unreadable = logger();
    await releaseSlugClaimAfterFailure(
      storeWith(async () => {
        throw new Error("database locked");
      }, release),
      unreadable,
      await claimedRequest(),
    );
    expect(release).not.toHaveBeenCalled();
    expect(unreadable.errors).toHaveLength(1);

    const faulting = logger();
    await releaseSlugClaimAfterFailure(
      storeWith(
        async () => {
          throw new ResourceNotFoundError("organization acme");
        },
        async () => {
          throw new Error("database locked");
        },
      ),
      faulting,
      await claimedRequest(),
    );
    expect(faulting.errors).toHaveLength(1);
  });

  it("does nothing for a request that never claimed", async () => {
    const release = vi.fn(async () => {});
    const unclaimed = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "acme" } }),
      testCallerIdentity(),
    );
    await releaseSlugClaimAfterFailure(
      storeWith(async () => {
        throw new ResourceNotFoundError("organization acme");
      }, release),
      logger(),
      unclaimed,
    );
    expect(release).not.toHaveBeenCalled();
  });
});

describe("a rename whose row write fails", () => {
  function renameRequest() {
    const organization = create(OrganizationSchema, {
      metadata: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", slug: "acme" },
    });
    const ctx = new RequestContext(
      RenameInputSchema,
      create(RenameInputSchema, {
        resourceId: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
        slug: "acme-corp",
      }),
      testCallerIdentity(),
    );
    ctx.set(RENAMED_ORGANIZATION_KEY, organization);
    return ctx;
  }

  it("moves the names back and fails; a failed move back is logged and the write's error stands", async () => {
    const moves: ResourceNameRename[] = [];
    const reverts: ResourceNameRename[] = [];
    let revertFails = false;
    const store = {
      resourceNames: {
        current: async () => undefined,
        rename: async (move: ResourceNameRename) => {
          moves.push(move);
          return {
            claimed: true,
            entry: { ...organizationNameKey(move.to), id: move.id, state: "current", claimedAt: move.now, expiresAt: "" },
          };
        },
        revertRename: async (move: ResourceNameRename) => {
          if (revertFails) {
            throw new Error("database locked");
          }
          reverts.push(move);
        },
      },
      saveResource: async () => {
        throw new Error("disk full");
      },
    } as unknown as Store;
    const errors: string[] = [];
    const logger = {
      error: (message: string) => errors.push(message),
      warn: () => {},
      info: () => {},
      debug: () => {},
    } as unknown as Logger;

    const ctx = renameRequest();
    await newRenameOrganizationSlugStep(store).execute(ctx);
    await expect(
      newPersistRenamedOrganizationStep(store, logger).execute(ctx),
    ).rejects.toThrow();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: "acme", to: "acme-corp" });
    expect(reverts).toEqual(moves);

    revertFails = true;
    const again = renameRequest();
    await newRenameOrganizationSlugStep(store).execute(again);
    await expect(
      newPersistRenamedOrganizationStep(store, logger).execute(again),
    ).rejects.toThrow();
    expect(errors).toHaveLength(1);
  });

  it("hands the move back the name it took back, so the store restores it rather than letting it go", async () => {
    const takenBack: ResourceNameEntry = {
      ...organizationNameKey("acme-corp"),
      id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
      state: "previous",
      claimedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
    };
    const reverts: Array<ResourceNameEntry | undefined> = [];
    const store = {
      resourceNames: {
        current: async () => undefined,
        rename: async (move: ResourceNameRename) => ({
          claimed: true,
          entry: { ...takenBack, state: "current", claimedAt: move.now, expiresAt: "" },
          takenBack,
        }),
        revertRename: async (_move: ResourceNameRename, restored?: ResourceNameEntry) => {
          reverts.push(restored);
        },
      },
      saveResource: async () => {
        throw new Error("disk full");
      },
    } as unknown as Store;
    const logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger;

    const ctx = renameRequest();
    await newRenameOrganizationSlugStep(store).execute(ctx);
    await expect(newPersistRenamedOrganizationStep(store, logger).execute(ctx)).rejects.toThrow();
    expect(reverts).toEqual([takenBack]);
  });
});

/** The ConnectError a step fails with. */
async function stepRefusal(run: () => Promise<void> | void): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the step to fail");
}

const HELD_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

/** A store double whose organization row read answers `read`. */
function rowStore(read: () => Promise<unknown>): Store & {
  getResource: ReturnType<typeof vi.fn>;
} {
  return { getResource: vi.fn(read) } as unknown as Store & {
    getResource: ReturnType<typeof vi.fn>;
  };
}

const rowMissing = async () => {
  throw new ResourceNotFoundError("organization");
};
const storeFault = async () => {
  throw new Error("database locked");
};

describe("settleOrganizationSlug", () => {
  const ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
  function organizationNamed(slug: string): Organization {
    return create(OrganizationSchema, { metadata: { id: ID, slug } });
  }
  function storeWith(currents: Array<string | undefined | Error>) {
    const saved: string[] = [];
    const store = {
      resourceNames: {
        current: async () => {
          const next = currents.shift();
          if (next instanceof Error) {
            throw next;
          }
          return next === undefined ? undefined : { ...organizationNameKey(next), id: ID, state: "current", claimedAt: "", expiresAt: "" };
        },
      },
      saveResource: async (_kind: unknown, _id: unknown, _schema: unknown, organization: Organization) => {
        saved.push(organization.metadata?.slug ?? "");
      },
    } as unknown as Store;
    return { store, saved };
  }
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message), error: () => {}, info: () => {}, debug: () => {} } as unknown as Logger;

  it("rewrites the row until it holds the current name, and leaves a settled one alone", async () => {
    const moved = storeWith(["acme-c", "acme-c"]);
    const organization = organizationNamed("acme-b");
    await settleOrganizationSlug(moved.store, organization, logger);
    expect(moved.saved).toEqual(["acme-c"]);
    expect(organization.metadata?.slug).toBe("acme-c");

    const settled = storeWith(["acme-b"]);
    await settleOrganizationSlug(settled.store, organizationNamed("acme-b"), logger);
    expect(settled.saved).toEqual([]);

    const nameless = storeWith([undefined]);
    await settleOrganizationSlug(nameless.store, organizationNamed("acme-b"), logger);
    expect(nameless.saved).toEqual([]);
  });

  it("stops after its attempts, logs a fault instead of failing the write, and skips a row with no id", async () => {
    const churning = storeWith(["a", "b", "c", "d"]);
    await settleOrganizationSlug(churning.store, organizationNamed("z"), logger);
    expect(churning.saved).toEqual(["a", "b", "c"]);

    const faulty = storeWith([new Error("database locked")]);
    await settleOrganizationSlug(faulty.store, organizationNamed("acme-b"), logger);
    expect(warnings).toHaveLength(1);

    const unsaved = storeWith(["acme-c"]);
    await settleOrganizationSlug(unsaved.store, create(OrganizationSchema, {}), logger);
    await settleOrganizationSlug(unsaved.store, create(OrganizationSchema, { metadata: { slug: "x" } }), logger);
    expect(unsaved.saved).toEqual([]);
  });
});

describe("nameHolderIsGone", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const claimedAgo = (ms: number): ResourceNameEntry => ({
    ...organizationNameKey("acme"),
    id: HELD_ID,
    state: "current",
    claimedAt: new Date(now.getTime() - ms).toISOString(),
    expiresAt: "",
  });
  const old = claimedAgo(ABANDONED_NAME_AFTER_MS + 1000);

  it("never counts a young name gone, and reads no row for it: its create may be in flight", async () => {
    const store = rowStore(rowMissing);
    expect(await nameHolderIsGone(store, claimedAgo(1000), now)).toBe(false);
    expect(store.getResource).not.toHaveBeenCalled();
  });

  it("counts an old name gone only when no organization row holds its id", async () => {
    expect(await nameHolderIsGone(rowStore(rowMissing), old, now)).toBe(true);
    expect(
      await nameHolderIsGone(rowStore(async () => create(OrganizationSchema)), old, now),
    ).toBe(false);
  });

  it("never counts a name equal to its id gone: an earlier release filed an organization under it", async () => {
    const store = rowStore(rowMissing);
    const reserved: ResourceNameEntry = { ...old, name: "veteran", id: "veteran", state: "previous" };
    expect(await nameHolderIsGone(store, reserved, now)).toBe(false);
    expect(store.getResource).not.toHaveBeenCalled();
  });

  it("rejects with a store fault rather than guessing, so a name is never freed on a failed read", async () => {
    await expect(nameHolderIsGone(rowStore(storeFault), old, now)).rejects.toThrow(
      "database locked",
    );
  });
});

describe("ClaimOrganizationSlug's server faults", () => {
  it("refuses a new state with no id as a server fault, claiming nothing", async () => {
    const claim = vi.fn();
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "acme" } }),
      testCallerIdentity(),
    );
    const fault = await stepRefusal(() =>
      newClaimOrganizationSlugStep({ resourceNames: { claim } } as unknown as Store).execute(ctx),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to claim the organization slug");
    expect(claim).not.toHaveBeenCalled();
  });

  it("answers Internal when the name table faults", async () => {
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "acme", id: HELD_ID } }),
      testCallerIdentity(),
    );
    const store = { resourceNames: { claim: storeFault } } as unknown as Store;
    const fault = await stepRefusal(() => newClaimOrganizationSlugStep(store).execute(ctx));
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to claim the organization slug");
  });
});

describe("RetireOrganizationSlug", () => {
  function deleteRequest(loaded?: Organization) {
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema),
      testCallerIdentity(),
    );
    if (loaded !== undefined) {
      ctx.set(EXISTING_RESOURCE_KEY, loaded);
    }
    return ctx;
  }
  const silent = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  } as unknown as Logger;

  it("releases every name the loaded organization held", async () => {
    const release = vi.fn(async () => {});
    const store = { resourceNames: { release } } as unknown as Store;
    await newRetireOrganizationSlugStep(store, silent).execute(
      deleteRequest(create(OrganizationSchema, { metadata: { id: HELD_ID } })),
    );
    expect(release).toHaveBeenCalledWith("organization", "", HELD_ID);
  });

  it("refuses to run without the loaded row as a server fault, releasing nothing", async () => {
    const release = vi.fn();
    const store = { resourceNames: { release } } as unknown as Store;
    const fault = await stepRefusal(() =>
      newRetireOrganizationSlugStep(store, silent).execute(deleteRequest()),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toBe("failed to release the organization slug");
    expect(release).not.toHaveBeenCalled();
  });
});

describe("the organization loaders", () => {
  function requestNaming(metadata?: { id?: string; slug?: string }) {
    return new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, metadata === undefined ? {} : { metadata }),
      testCallerIdentity(),
    );
  }
  /** A store double: the row read, and a name table where nothing holds any slug. */
  function loaderStore(read: () => Promise<unknown>): Store {
    return {
      getResource: read,
      resourceNames: { resolve: async () => undefined },
    } as unknown as Store;
  }

  it("apply creates when the manifest's id names no row", async () => {
    const ctx = requestNaming({ id: HELD_ID, slug: "acme" });
    await newLoadOrganizationForApplyStep(loaderStore(rowMissing)).execute(ctx);
    expect(ctx.get(SHOULD_CREATE_KEY)).toBe(true);
    expect(ctx.get(EXISTS_IN_DATABASE_KEY)).toBe(false);
    expect(ctx.get(EXISTING_RESOURCE_KEY)).toBeUndefined();
  });

  it("apply and update fail with a store fault instead of creating a second organization", async () => {
    await expect(
      newLoadOrganizationForApplyStep(loaderStore(storeFault)).execute(
        requestNaming({ id: HELD_ID, slug: "acme" }),
      ),
    ).rejects.toThrow("database locked");
    await expect(
      newLoadExistingOrganizationStep(loaderStore(storeFault)).execute(
        requestNaming({ id: HELD_ID }),
      ),
    ).rejects.toThrow("database locked");
  });

  it("update answers NotFound for an id or slug nothing holds, naming what was asked", async () => {
    const byId = await stepRefusal(() =>
      newLoadExistingOrganizationStep(loaderStore(rowMissing)).execute(
        requestNaming({ id: HELD_ID, slug: "acme" }),
      ),
    );
    expect(byId.code).toBe(Code.NotFound);
    expect(byId.rawMessage).toBe(`Organization not found: ${HELD_ID}`);

    const bySlug = await stepRefusal(() =>
      newLoadExistingOrganizationStep(loaderStore(rowMissing)).execute(
        requestNaming({ slug: "nobody" }),
      ),
    );
    expect(bySlug.code).toBe(Code.NotFound);
    expect(bySlug.rawMessage).toBe("Organization not found: nobody");
  });

  it("update refuses a request naming neither id nor slug, and a missing metadata is a server fault", async () => {
    const unnamed = await stepRefusal(() =>
      newLoadExistingOrganizationStep(loaderStore(rowMissing)).execute(requestNaming({})),
    );
    expect(unnamed.code).toBe(Code.InvalidArgument);
    expect(unnamed.rawMessage).toBe("resource id or slug is required for update");

    const noMetadata = await stepRefusal(() =>
      newLoadExistingOrganizationStep(loaderStore(rowMissing)).execute(requestNaming()),
    );
    expect(noMetadata.code).toBe(Code.Internal);
  });
});
