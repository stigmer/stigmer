/**
 * Pins the create side of "an organization's slug is its for good"
 * (slug-ledger.ts) through a composed server in the trusted-local posture:
 *
 *   - of two concurrent creates of one slug exactly one succeeds, and the
 *     other is refused as a duplicate with one owner row between them;
 *   - a create racing another create's claim, before that create's row
 *     exists, is refused as a duplicate, never as a deleted organization's;
 *   - a pre-side-effect gate's refusal leaves no claim, so the create
 *     succeeds once the gate lets it;
 *   - a create that fails after its row is stored keeps its slug;
 *   - an organization no ledger entry records (one an older binary created)
 *     is still refused as a duplicate by its row, and its delete retires
 *     the slug.
 *
 * And, over doubles, the release a failed create runs: it frees the claim
 * only when the organization was never stored, and every fault it meets
 * leaves the slug claimed.
 *
 * The delete side (the retire, its order and its faults) is
 * organization-delete.test.ts's.
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
import { metadataOf } from "../../../pipeline/steps/shapes.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { OrganizationSlugEntry, Store } from "../../../store/interface.js";
import { fakeIamPolicyStore } from "../../iampolicy/__tests__/support.js";
import {
  newClaimOrganizationSlugStep,
  releaseSlugClaimAfterFailure,
} from "../slug-ledger.js";

const OPERATOR_EMAIL = "operator@example.com";
const DUPLICATE_COPY = (slug: string) =>
  `Organization already exists: slug '${slug}'`;

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
    spec: { description: "created by the organization slug test" },
  };
}

describe("organization slugs on create (composed server, trusted-local posture)", () => {
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
      const slug = slugOf(ctx.newState as Organization);
      if (gateRefuses.has(slug)) {
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
      const slug = slugOf(ctx.newState as Organization);
      if (postPersistFails.has(slug)) {
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

  function ownersOf(org: string): number {
    return [...policies.rows.values()].filter(
      (policy) =>
        policy.spec?.resource?.kind === "organization" &&
        policy.spec.resource.id === org &&
        policy.spec.relation === "owner",
    ).length;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-slugs-test-"));
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

  it("of two concurrent creates of one slug, exactly one succeeds and the other is a duplicate", async () => {
    const results = await Promise.allSettled([
      organizations.create(organizationInput("contended")),
      organizations.create(organizationInput("contended")),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const refusal = ConnectError.from(rejected?.reason);
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe(DUPLICATE_COPY("contended"));
    expect(refusal.findDetails(ErrorInfoSchema)).toEqual([]);
    expect(ownersOf("contended")).toBe(1);
  });

  it("a create racing another create's claim, before its row exists, is a duplicate and never a deleted organization's", async () => {
    const inFlight = await server.store.organizationSlugs.claim("in-flight");
    expect(inFlight.claimed).toBe(true);

    const refusal = await grpcError(() =>
      organizations.create(organizationInput("in-flight")),
    );
    expect(refusal.code).toBe(Code.AlreadyExists);
    expect(refusal.rawMessage).toBe(DUPLICATE_COPY("in-flight"));
    expect(refusal.findDetails(ErrorInfoSchema)).toEqual([]);
  });

  it("a pre-side-effect gate's refusal leaves no claim, so the create succeeds once the gate lets it", async () => {
    gateRefuses.add("gated");
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("gated")),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(await server.store.organizationSlugs.find("gated")).toBeUndefined();

    gateRefuses.delete("gated");
    const created = await organizations.create(organizationInput("gated"));
    expect(created.metadata?.id).toBe("gated");
  });

  it("a create that fails after its row is stored keeps its slug", async () => {
    postPersistFails.add("half-made");
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("half-made")),
    );
    expect(refusal.code).toBe(Code.Unavailable);

    const entry = await server.store.organizationSlugs.find("half-made");
    expect(entry?.retiredAt).toBe("");
    expect(
      (await organizationQuery.get({ value: "half-made" })).metadata?.id,
    ).toBe("half-made");

    postPersistFails.delete("half-made");
    const retry = await grpcError(() =>
      organizations.create(organizationInput("half-made")),
    );
    expect(retry.code).toBe(Code.AlreadyExists);
    expect(retry.rawMessage).toBe(DUPLICATE_COPY("half-made"));
  });

  it("an organization no ledger entry records is refused as a duplicate by its row, and its delete retires the slug", async () => {
    await organizations.create(organizationInput("older"));
    // What an older binary leaves: the row, and no ledger entry.
    const entry = await server.store.organizationSlugs.find("older");
    await server.store.organizationSlugs.release(entry!);
    expect(await server.store.organizationSlugs.find("older")).toBeUndefined();

    const duplicate = await grpcError(() =>
      organizations.create(organizationInput("older")),
    );
    expect(duplicate.code).toBe(Code.AlreadyExists);
    expect(duplicate.rawMessage).toBe(DUPLICATE_COPY("older"));

    await organizations.delete({ value: "older" });
    const reserved = await grpcError(() =>
      organizations.create(organizationInput("older")),
    );
    expect(reserved.code).toBe(Code.AlreadyExists);
    expect(reserved.findDetails(ErrorInfoSchema)[0]?.reason).toBe(
      "ORGANIZATION_SLUG_RESERVED",
    );
  });
});

describe("releaseSlugClaimAfterFailure", () => {
  const entry: OrganizationSlugEntry = {
    slug: "acme",
    claimedAt: "2026-09-28T00:00:00.000Z",
    retiredAt: "",
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

  /** A store double: the organization row's read and the ledger's release. */
  function storeWith(
    rowRead: () => Promise<unknown>,
    release: (claim: OrganizationSlugEntry) => Promise<void>,
  ): Store {
    return {
      getResource: rowRead,
      organizationSlugs: {
        claim: async () => ({ claimed: true, entry }),
        retire: async () => {},
        release,
        find: async () => entry,
      },
    } as unknown as Store;
  }

  /** A request whose ClaimOrganizationSlug won `entry`. */
  async function claimedRequest(): Promise<
    RequestContext<typeof OrganizationSchema>
  > {
    const ctx = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "acme" } }),
      testCallerIdentity(),
    );
    const claiming = {
      organizationSlugs: { claim: async () => ({ claimed: true, entry }) },
    } as unknown as Store;
    await newClaimOrganizationSlugStep(claiming).execute(ctx);
    expect(metadataOf(ctx.newState)?.slug).toBe("acme");
    return ctx;
  }

  it("frees the claim when the organization was never stored", async () => {
    const release = vi.fn(async () => {});
    const store = storeWith(async () => {
      throw new ResourceNotFoundError("organization acme");
    }, release);

    await releaseSlugClaimAfterFailure(store, logger(), await claimedRequest());
    expect(release).toHaveBeenCalledWith(entry);
  });

  it("keeps the claim when the organization was stored", async () => {
    const release = vi.fn(async () => {});
    const store = storeWith(async () => ({}), release);

    await releaseSlugClaimAfterFailure(store, logger(), await claimedRequest());
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
    const store = storeWith(async () => {
      throw new ResourceNotFoundError("organization acme");
    }, release);
    const unclaimed = new RequestContext(
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { slug: "acme" } }),
      testCallerIdentity(),
    );

    await releaseSlugClaimAfterFailure(store, logger(), unclaimed);
    expect(release).not.toHaveBeenCalled();
  });
});
