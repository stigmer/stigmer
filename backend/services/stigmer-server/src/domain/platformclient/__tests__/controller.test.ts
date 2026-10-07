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
 *   - the reserved slug is refused, the two sign-in role rules are refused on
 *     the contract, and a system-managed client refuses update, delete and
 *     rotate with the cloud's copy;
 *   - create and update run the reference rule on `credentials`: a bare
 *     credential slug is stored under the client's organization, a missing
 *     credential is refused on either chain before anything is stored, and
 *     another organization's credential is refused with the rule's one
 *     sentence;
 *   - every assignment a write introduces carries the server's writer
 *     stamp (the propagated person; "" for the server acting as itself),
 *     never the client's claim, and a person's own credential is refused:
 *     a client's users are not people whose credentials a run may use;
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

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialAssignmentSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
import {
  createInProcessCallerInterceptor,
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
} from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
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
    spec: { createAccountsOnSignIn: true, ...spec },
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

/** A credential row of `org`, owned by the organization or by `person`. */
async function seedCredential(
  org: string,
  slug: string,
  person?: string,
): Promise<void> {
  const id = `cred_${org}_${slug}`;
  await store.saveResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
    create(CredentialSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Credential",
      metadata: { id, name: slug, slug, org },
      spec: {
        owner:
          person === undefined
            ? { case: "org", value: org }
            : { case: "person", value: person },
        fields: { GITHUB_TOKEN: { value: "ghp-client", plain: true } },
      },
    }),
  );
}

/** An assignment giving the github.com host's GITHUB_TOKEN a credential's field. */
function assignmentOf(slug: string, org = "") {
  return {
    requirement: {
      declarer: { target: { case: "gitHost" as const, value: "github.com" } },
      key: "GITHUB_TOKEN",
    },
    source: {
      case: "credential" as const,
      value: {
        credential: { org, slug, kind: ApiResourceKind.credential },
        field: "",
      },
    },
  };
}

/** The `org/slug` each assignment of a spec names. */
function assignedRefsOf(spec: PlatformClientSpec | undefined): string[] {
  return (spec?.credentials ?? []).map((assignment) =>
    assignment.source.case === "credential"
      ? `${assignment.source.value.credential?.org ?? ""}/${assignment.source.value.credential?.slug ?? ""}`
      : "",
  );
}

function credentialTarget() {
  const entry = referenceTargetKind(ApiResourceKind.credential);
  if (entry === undefined)
    throw new Error("credential is not a reference target kind");
  return entry;
}

/** Call options presenting `identityId` as the propagated person the server composes for. */
function asPerson(identityId: string) {
  return {
    headers: {
      [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(
        testCallerIdentity({ identityId }),
      ),
    },
  };
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
      spec: { createAccountsOnSignIn: false },
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

  it("refuses the reserved slug and the two sign-in role rules", async () => {
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
          signInRole: IamRole.owner,
        }),
      ),
    );
    expect(owner.code).toBe(Code.InvalidArgument);

    const noProvision = await refusal(
      command.create(
        input("No provision", {
          createAccountsOnSignIn: false,
          signInRole: IamRole.viewer,
        }),
      ),
    );
    expect(noProvision.code).toBe(Code.InvalidArgument);
  });

  it("stores a bare credential slug under the client's organization, the writer stamped by the server", async () => {
    await seedCredential("acme", "support-secrets");
    const created = await command.create(
      input("Dashboard", {
        credentials: [
          { ...assignmentOf("support-secrets"), writer: "someone-else" },
        ],
      }),
      asPerson("alice"),
    );
    expect(assignedRefsOf(created.platformClient?.spec)).toEqual([
      "acme/support-secrets",
    ]);
    expect(created.platformClient?.spec?.credentials[0]?.writer).toBe("alice");
    const id = created.platformClient?.metadata?.id ?? "";
    const stored = (await clients.findById(id))?.spec;
    expect(assignedRefsOf(stored)).toEqual(["acme/support-secrets"]);
    expect(stored?.credentials[0]?.writer).toBe("alice");
  });

  it("stamps no writer when the server acting as itself writes the assignment", async () => {
    await seedCredential("acme", "server-secrets");
    const created = await command.create(
      input("Dashboard", {
        credentials: [{ ...assignmentOf("server-secrets"), writer: "someone-else" }],
      }),
    );
    expect(created.platformClient?.spec?.credentials[0]?.writer).toBe("");
  });

  it("refuses a person's own credential: a client's users are not people whose credentials a run may use", async () => {
    await seedCredential("acme", "alice-key", "alice");
    const refused = await refusal(
      command.create(
        input("Dashboard", { credentials: [assignmentOf("alice-key")] }),
        asPerson("alice"),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "credential 'alice-key' is a person's own and cannot be assigned on a platform client: its runs have no person behind them. Assign one of the organization's credentials instead",
    );
    expect((await query.listByOrg({ org: "acme" })).entries).toEqual([]);
  });

  it("refuses a missing credential on create and on update, storing nothing", async () => {
    const missing = missingReferencesMessage(credentialTarget(), [
      { slug: "ghost", org: "acme" },
    ]);

    const onCreate = await refusal(
      command.create(input("Dashboard", { credentials: [assignmentOf("ghost")] })),
    );
    expect(onCreate.code).toBe(Code.FailedPrecondition);
    expect(onCreate.rawMessage).toBe(missing);
    expect((await query.listByOrg({ org: "acme" })).entries).toEqual([]);

    const created = await command.create(input("Dashboard"));
    const stored = created.platformClient;
    if (stored?.spec === undefined) throw new Error("create answered no spec");
    const withGhost = clone(PlatformClientSchema, stored);
    withGhost.spec = clone(PlatformClientSpecSchema, stored.spec);
    withGhost.spec.credentials = [
      create(CredentialAssignmentSchema, assignmentOf("ghost")),
    ];
    const onUpdate = await refusal(command.update(withGhost));
    expect(onUpdate.code).toBe(Code.FailedPrecondition);
    expect(onUpdate.rawMessage).toBe(missing);
    expect(
      (await clients.findById(stored.metadata?.id ?? ""))?.spec?.credentials,
    ).toEqual([]);
  });

  it("refuses another organization's credential with the rule's one sentence", async () => {
    await seedCredential("globex", "shared");
    const foreign = await refusal(
      command.create(
        input("Dashboard", { credentials: [assignmentOf("shared", "globex")] }),
      ),
    );
    expect(foreign.code).toBe(Code.FailedPrecondition);
    expect(foreign.rawMessage).toBe(
      notAvailableReferenceMessage(credentialTarget(), {
        kind: ApiResourceKind.credential,
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
