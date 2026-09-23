/**
 * Pins the PlatformClient chains over the OSS adapter on sqlite, through the
 * package's own interceptor chain (validation included):
 *   - create answers the secret once and a client whose stored hash never
 *     leaves: not on create, get, getByReference, listByOrg, update,
 *     rotateSecret or delete — while the ROW keeps the hash the mint needs;
 *   - update replaces the spec and keeps the credentials, addressed by id
 *     or by org-scoped slug;
 *   - rotateSecret replaces the secret and fingerprint under the same
 *     client_id, and the row's hash follows;
 *   - the reserved slug is refused, the two auto-grant rules are refused on
 *     the contract, and a system-managed client refuses update, delete and
 *     rotate with the cloud's copy;
 *   - create and update run the reference rule on `environment_refs`: a
 *     bare slug is stored under the client's organization, a missing
 *     environment is refused on either chain before anything is stored, and
 *     another organization's environment is refused with the rule's one
 *     sentence;
 *   - listByOrg answers the organization's clients, newest first.
 * Who may read a client is the enforcing lane's conformance suite's.
 */
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import type { PlatformClientSpec } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import {
  SYSTEM_MANAGED_LABEL,
  RESERVED_LABEL_TRUE,
} from "../../../pipeline/apiresource-labels.js";
import { buildInterceptorChain } from "../../../pipeline/chain.js";
import { createInProcessCallerInterceptor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import {
  missingReferencesMessage,
  notAvailableReferenceMessage,
  referenceTargetKind,
} from "../../../pipeline/steps/references.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { reservedSlugMessage, systemManagedMessage } from "../constants.js";
import { registerPlatformClientServices } from "../controller.js";
import { hashClientSecret } from "../credentials.js";
import { newResourcePlatformClientStore } from "../resource-store.js";
import type { PlatformClientStore } from "../store.js";

let cleanup: () => void;
let store: Store;
let clients: PlatformClientStore;
let command: Client<typeof PlatformClientCommandController>;
let query: Client<typeof PlatformClientQueryController>;

beforeEach(() => {
  const temp = tempStore();
  cleanup = () => temp.cleanup();
  store = temp.store;
  clients = newResourcePlatformClientStore(temp.store);
  const transport = createRouterTransport(
    (router) =>
      registerPlatformClientServices(router, {
        clients,
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        listReadScope: undefined,
      }),
    {
      router: {
        interceptors: buildInterceptorChain(
          silentLogger,
          createInProcessCallerInterceptor(),
        ),
      },
    },
  );
  command = createClient(PlatformClientCommandController, transport);
  query = createClient(PlatformClientQueryController, transport);
});

afterEach(() => cleanup());

function input(
  name: string,
  spec: MessageInitShape<typeof PlatformClientSpecSchema> = {},
) {
  return create(PlatformClientSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: { name, org: "acme" },
    spec: { autoProvisionAccounts: true, ...spec },
  });
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

async function seedEnvironment(org: string, slug: string): Promise<void> {
  const id = `env_${org}_${slug}`;
  await store.saveResource(
    ApiResourceKind.environment,
    id,
    EnvironmentSchema,
    create(EnvironmentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Environment",
      metadata: {
        id,
        name: slug,
        slug,
        org,
        visibility: ApiResourceVisibility.visibility_org,
      },
    }),
  );
}

function environmentRef(slug: string, org = "") {
  return { org, slug, kind: ApiResourceKind.environment };
}

function environmentTarget() {
  const entry = referenceTargetKind(ApiResourceKind.environment);
  if (entry === undefined)
    throw new Error("environment is not a reference target kind");
  return entry;
}

describe("PlatformClient chains", () => {
  it("shows the secret once and never returns the stored hash, which the row keeps", async () => {
    const created = await command.create(input("Dashboard"));
    const id = created.platformClient?.metadata?.id ?? "";
    expect(id).toMatch(/^pcl_/);
    expect(created.clientSecret).toMatch(/^stgm_cs_/);
    expect(created.platformClient?.spec?.clientSecretHash).toBe("");
    expect(created.platformClient?.spec?.secretFingerprint).toBe(
      created.clientSecret.slice(-6),
    );

    expect((await clients.findById(id))?.spec?.clientSecretHash).toBe(
      hashClientSecret(created.clientSecret),
    );
    expect((await query.get({ value: id })).spec?.clientSecretHash).toBe("");
    expect(
      (
        await query.getByReference({
          org: "acme",
          slug: "dashboard",
          kind: ApiResourceKind.platform_client,
        })
      ).spec?.clientSecretHash,
    ).toBe("");
    const listed = await query.listByOrg({ org: "acme" });
    expect(listed.entries.map((entry) => entry.spec?.clientSecretHash)).toEqual(
      [""],
    );
  });

  it("update keeps the credentials, addressed by id or by slug", async () => {
    const created = await command.create(input("Dashboard"));
    const stored = created.platformClient;
    const clientId = stored?.spec?.clientId ?? "";

    if (stored?.spec === undefined) throw new Error("create answered no spec");
    const byId = clone(PlatformClientSchema, stored);
    byId.spec = clone(PlatformClientSpecSchema, stored.spec);
    byId.spec.clientId = "stgm_cid_forged";
    byId.spec.allowedOrigins = ["https://a.example"];
    const updated = await command.update(byId);
    expect(updated.spec?.clientId).toBe(clientId);
    expect(updated.spec?.allowedOrigins).toEqual(["https://a.example"]);
    expect(updated.spec?.clientSecretHash).toBe("");

    const bySlug = create(PlatformClientSchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "PlatformClient",
      metadata: { name: "Dashboard", org: "acme", slug: "dashboard" },
      spec: { autoProvisionAccounts: false },
    });
    const viaSlug = await command.update(bySlug);
    expect(viaSlug.metadata?.id).toBe(stored?.metadata?.id);
    expect(viaSlug.spec?.clientId).toBe(clientId);
    expect(
      (await clients.findById(stored?.metadata?.id ?? ""))?.spec
        ?.clientSecretHash,
    ).toBe(hashClientSecret(created.clientSecret));
  });

  it("rotateSecret replaces the secret under the same client_id, and the row follows", async () => {
    const created = await command.create(input("Dashboard"));
    const id = created.platformClient?.metadata?.id ?? "";
    const rotated = await command.rotateSecret({ value: id });

    expect(rotated.clientSecret).not.toBe(created.clientSecret);
    expect(rotated.platformClient?.spec?.clientId).toBe(
      created.platformClient?.spec?.clientId,
    );
    expect(rotated.platformClient?.spec?.secretFingerprint).toBe(
      rotated.clientSecret.slice(-6),
    );
    expect(rotated.platformClient?.spec?.clientSecretHash).toBe("");
    expect((await clients.findById(id))?.spec?.clientSecretHash).toBe(
      hashClientSecret(rotated.clientSecret),
    );
  });

  it("refuses the reserved slug and the two auto-grant rules", async () => {
    const reserved = await refusal(
      command.create(
        create(PlatformClientSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "PlatformClient",
          metadata: { name: "System Share Client", org: "acme" },
        }),
      ),
    );
    expect(reserved.code).toBe(Code.InvalidArgument);
    expect(reserved.rawMessage).toBe(
      reservedSlugMessage("system-share-client"),
    );

    const owner = await refusal(
      command.create(
        input("Owner grant", {
          autoGrantOnOrg: true,
          autoGrantRole: IamRole.owner,
        }),
      ),
    );
    expect(owner.code).toBe(Code.InvalidArgument);

    const noProvision = await refusal(
      command.create(
        input("No provision", {
          autoProvisionAccounts: false,
          autoGrantOnOrg: true,
        }),
      ),
    );
    expect(noProvision.code).toBe(Code.InvalidArgument);
  });

  it("stores a bare environment slug under the client's organization", async () => {
    await seedEnvironment("acme", "support-secrets");
    const created = await command.create(
      input("Dashboard", {
        environmentRefs: [environmentRef("support-secrets")],
      }),
    );
    const refsOf = (spec: PlatformClientSpec | undefined) =>
      (spec?.environmentRefs ?? []).map((ref) => `${ref.org}/${ref.slug}`);
    expect(refsOf(created.platformClient?.spec)).toEqual([
      "acme/support-secrets",
    ]);
    const id = created.platformClient?.metadata?.id ?? "";
    expect(refsOf((await clients.findById(id))?.spec)).toEqual([
      "acme/support-secrets",
    ]);
  });

  it("refuses a missing environment on create and on update, storing nothing", async () => {
    const missing = missingReferencesMessage(environmentTarget(), [
      { slug: "ghost", org: "acme" },
    ]);

    const onCreate = await refusal(
      command.create(
        input("Dashboard", { environmentRefs: [environmentRef("ghost")] }),
      ),
    );
    expect(onCreate.code).toBe(Code.FailedPrecondition);
    expect(onCreate.rawMessage).toBe(missing);
    expect((await query.listByOrg({ org: "acme" })).entries).toEqual([]);

    const created = await command.create(input("Dashboard"));
    const stored = created.platformClient;
    if (stored?.spec === undefined) throw new Error("create answered no spec");
    const withGhost = clone(PlatformClientSchema, stored);
    withGhost.spec = clone(PlatformClientSpecSchema, stored.spec);
    withGhost.spec.environmentRefs = [
      create(ApiResourceReferenceSchema, environmentRef("ghost")),
    ];
    const onUpdate = await refusal(command.update(withGhost));
    expect(onUpdate.code).toBe(Code.FailedPrecondition);
    expect(onUpdate.rawMessage).toBe(missing);
    expect(
      (await clients.findById(stored.metadata?.id ?? ""))?.spec
        ?.environmentRefs,
    ).toEqual([]);
  });

  it("refuses another organization's environment with the rule's one sentence", async () => {
    await seedEnvironment("globex", "shared");
    const foreign = await refusal(
      command.create(
        input("Dashboard", {
          environmentRefs: [environmentRef("shared", "globex")],
        }),
      ),
    );
    expect(foreign.code).toBe(Code.FailedPrecondition);
    expect(foreign.rawMessage).toBe(
      notAvailableReferenceMessage(environmentTarget(), {
        kind: ApiResourceKind.environment,
        org: "globex",
        slug: "shared",
      }),
    );
  });

  it("refuses to update, delete or rotate a system-managed client", async () => {
    await clients.save(
      create(PlatformClientSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "PlatformClient",
        metadata: {
          id: "pcl_system",
          name: "System Share Client",
          org: "acme",
          slug: "system-share-client",
          labels: { [SYSTEM_MANAGED_LABEL]: RESERVED_LABEL_TRUE },
        },
        spec: { clientId: "stgm_cid_system" },
      }),
    );
    const stored = await clients.findById("pcl_system");
    if (stored === undefined) throw new Error("seeded client missing");

    const update = await refusal(command.update(stored));
    expect(update.code).toBe(Code.FailedPrecondition);
    expect(update.rawMessage).toBe(systemManagedMessage("updated"));

    const rotate = await refusal(command.rotateSecret({ value: "pcl_system" }));
    expect(rotate.rawMessage).toBe(systemManagedMessage("rotated"));

    const remove = await refusal(command.delete({ resourceId: "pcl_system" }));
    expect(remove.rawMessage).toBe(systemManagedMessage("deleted"));
    expect(await clients.findById("pcl_system")).toBeDefined();
  });

  it("listByOrg answers the organization's clients newest first", async () => {
    for (const [id, seconds] of [
      ["pcl_older", 1_000],
      ["pcl_newer", 2_000],
    ] as const) {
      await clients.save(
        create(PlatformClientSchema, {
          metadata: { id, name: id, org: "acme", slug: id },
          spec: { clientId: `stgm_cid_${id}` },
          status: {
            audit: { specAudit: { createdAt: { seconds: BigInt(seconds) } } },
          },
        }),
      );
    }
    const listed = await query.listByOrg({ org: "acme" });
    expect(listed.entries.map((entry) => entry.metadata?.id)).toEqual([
      "pcl_newer",
      "pcl_older",
    ]);
    expect((await query.listByOrg({ org: "globex" })).entries).toEqual([]);
  });

  it("delete answers the client without its hash and removes it", async () => {
    const created = await command.create(input("Dashboard"));
    const id = created.platformClient?.metadata?.id ?? "";

    const deleted = await command.delete({ resourceId: id });
    expect(deleted.spec?.clientSecretHash).toBe("");
    expect(await clients.findById(id)).toBeUndefined();
  });
});
