/**
 * Pins the two unit points and the edition's sign-in rule on real boots
 * (extensions/composed-services.ts, boot/compose.ts):
 *
 *   - `onComposed` hands every unit the composition's own instances before
 *     `composeServer` returns: the Authorizer and list scope a unit
 *     registered, bound by the credential binding (an unbound caller
 *     reaches the registered driver; a caller bound elsewhere is denied
 *     before it), the binding itself, its engine's check and its
 *     lifecycle, and the one in-process transport; under open source's own
 *     authorization, the built-in Authorizer, list scope and policy check;
 *     in every posture, the identity accounts' store binding and the one
 *     create path, through which a unit provisions a federated account at
 *     its provider-and-subject address; and the policy store binding's
 *     reads, the registered driver where a unit registered one and open
 *     source's adapter over the composition's store otherwise; which
 *     organization a resource belongs to, from the row where no scope link
 *     says (open source's own authorization seeds none); and the store's
 *     one name table, where a unit's claim is the one every chain meets.
 *   - `start` runs in unit order, first in `start()`, before the server
 *     reports SERVING; a failing start fails `start()`, naming its unit.
 *   - An edition above open source with no sign-in is refused at boot,
 *     whichever authorizer it runs.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { HealthCheckResponse_ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { federatedAccountIdFor } from "../../domain/identityaccount/constants.js";
import { policyIdFor } from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { serverActingFor } from "../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../pipeline/steps/authorize.js";
import { platformTokenKeyRingFromPem } from "../../platformtoken/key-ring.js";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { ApiResourceRefSchema, IamPolicySpecSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../authorization/credential-binding.js";
import type { AuthorizationQueryEngine } from "../authorization-queries.js";
import type { Authorizer, AuthzCheck } from "../authorizer.js";
import type { ComposedServices } from "../composed-services.js";
import type { CallerIdentity, IdentityVerifier } from "../identity.js";
import type { ListReadScope } from "../list-read-scope.js";
import type { ServerExtension } from "../registry.js";
import type { ResourceAuthorizationLifecycle } from "../resource-authorization.js";
import type { ResourceRowReader } from "../resource-row-reader.js";
import { widerEditionPurge } from "./composed-support.js";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { RequestContext } from "../../pipeline/request-context.js";
import { testCallerIdentity } from "../../pipeline/__tests__/support.js";
import {
  newClaimNameStep,
  portHolder,
  resolveName,
} from "../../pipeline/steps/names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const verifier: IdentityVerifier = {
  name: "fixture-verifier",
  verify: () => Promise.resolve(null),
};
const ringKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: ringKeys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  publicKeyPems: [
    ringKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  ],
});
const noRows: ResourceRowReader = {
  findById: () => Promise.resolve(undefined),
};

/** An Enterprise unit on open source's own authorization: sign-in, a key ring, a reader per kind. */
function enterpriseUnit(extra: Partial<ServerExtension> = {}): ServerExtension {
  return {
    name: "enterprise-fixture",
    edition: ServerEdition.enterprise,
    orgPurge: widerEditionPurge,
    requireAuthentication: true,
    identityVerifiers: [verifier],
    drivers: {
      platformTokenKeys: RING,
      resourceRowReaders: new Map([
        [ApiResourceKind.federation_issuer, noRows],
        [ApiResourceKind.invitation, noRows],
        [ApiResourceKind.team, noRows],
      ]),
    },
    ...extra,
  };
}

const dirs: string[] = [];
const servers: ComposedServer[] = [];

async function compose(
  extensions: ReadonlyArray<ServerExtension>,
): Promise<ComposedServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "composed-services-"));
  dirs.push(dir);
  const server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions: [...extensions],
    portOverride: 0,
    host: "127.0.0.1",
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.shutdown();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("onComposed: a unit receives the composition's own instances", () => {
  it("hands a unit the Authorizer and list scope a unit registered, bound, the very check and lifecycle, and the one in-process transport, before composeServer returns", async () => {
    const permissive = newPermissiveSingleTeamAuthorizer();
    const asked: AuthzCheck[] = [];
    const authorizer: Authorizer = {
      authorize(caller, check) {
        asked.push(check);
        return permissive.authorize(caller, check);
      },
    };
    const listReadScope: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set(["agt_listed"])),
      restrictListEntries: () => Promise.resolve(new Set()),
    };
    const queries: AuthorizationQueryEngine = {
      check: () => Promise.resolve(true),
      listResourceIds: () => Promise.resolve([]),
      listPrincipalIds: () => Promise.resolve([]),
    };
    const lifecycle: ResourceAuthorizationLifecycle = {
      onResourceCreated: () => Promise.resolve(),
      onResourceDeleted: () => Promise.resolve(),
      onVisibilityChanged: () => Promise.resolve(),
    };
    const policies: IamPolicyStore = {
      save: () => Promise.resolve(),
      deleteById: () => Promise.resolve(),
      findById: () => Promise.resolve(undefined),
      findByPrincipal: () => Promise.resolve([]),
      findByResource: () => Promise.resolve([]),
      findByPrincipalAndResource: () => Promise.resolve([]),
      findByResourceWithRelations: () => Promise.resolve([]),
      countDistinctPrincipalsByResource: () => Promise.resolve(0),
      findByResourceKindAndRelation: () => Promise.resolve([]),
      findScopeTuple: () => Promise.resolve(undefined),
      listChanges: () => Promise.resolve([]),
      pruneChanges: () => Promise.resolve(0),
      lastChangeSequence: () => Promise.resolve(0n),
    };
    let received: ComposedServices | undefined;
    const server = await compose([
      {
        name: "cloud-shaped",
        edition: ServerEdition.cloud,
        orgPurge: widerEditionPurge,
        requireAuthentication: true,
        identityVerifiers: [verifier],
        authorizer,
        drivers: {
          platformTokenKeys: RING,
          listReadScope,
          authorizationQueries: queries,
          resourceAuthorizationLifecycle: lifecycle,
          iamPolicyStore: policies,
          resourceRowReaders: new Map([
            [ApiResourceKind.federation_issuer, noRows],
            [ApiResourceKind.invitation, noRows],
            [ApiResourceKind.team, noRows],
          ]),
        },
      },
      {
        name: "consumer",
        onComposed: (composed) => {
          received = composed;
        },
      },
    ]);
    expect(received).toBeDefined();
    const caller: CallerIdentity = {
      identityId: "ida_alice",
      callerClass: "user",
      issuer: "",
      rawToken: "token",
    };
    const elsewhere: AuthzCheck = {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.organization,
      resourceId: "org_beta",
    };
    expect(await received?.authorizer.authorize(caller, elsewhere)).toEqual({
      kind: "allow",
    });
    expect(asked).toEqual([elsewhere]);
    expect(
      await received?.authorizer.authorize(
        { ...caller, boundOrg: "org_alpha" },
        elsewhere,
      ),
    ).toEqual({ kind: "deny", reason: BOUND_ELSEWHERE_DENY_REASON });
    expect(asked).toHaveLength(1);
    expect([
      ...((await received?.listReadScope?.authorizedResourceIds(
        caller,
        ApiResourceKind.agent,
      )) ?? []),
    ]).toEqual(["agt_listed"]);
    expect(
      received?.credentialBinding.admitsOrganization(caller, "org_beta"),
    ).toBe(true);
    expect(received?.authorizationQueries).toBe(queries);
    expect(received?.resourceAuthorizationLifecycle).toBe(lifecycle);
    expect(received?.inProcessTransport).toBe(server.inProcessTransport);
    expect(received?.iamPolicies).toBe(policies);
  });

  it("under open source's own authorization hands the built-in Authorizer, list scope and policy check, and no lifecycle", async () => {
    let received: ComposedServices | undefined;
    await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    expect(received?.authorizer).toBeDefined();
    expect(received?.listReadScope).toBeDefined();
    expect(received?.authorizationQueries).toBeDefined();
    expect(received?.resourceAuthorizationLifecycle).toBeUndefined();
  });

  it("hands the identity accounts' store binding and the one create path, which provisions a federated account at its provider-and-subject address", async () => {
    let received: ComposedServices | undefined;
    await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    const accounts = received?.identityAccounts;
    if (accounts === undefined) {
      throw new Error("the unit received no identity accounts");
    }
    const providerOrg = "org_01hzacme000000000000000000";
    const created = await accounts.create(
      {
        name: "dana@acme.example",
        spec: create(IdentityAccountSpecSchema, {
          idpId: "okta|dana",
          email: "dana@acme.example",
        }),
        provisioning: {
          mode: "federated",
          provider: { org: providerOrg, id: "fis_01hzacmeokta0000000000000" },
        },
      },
      serverActingFor("fis_01hzacmeokta0000000000000"),
    );
    expect(created.metadata?.id).toBe(
      federatedAccountIdFor("fis_01hzacmeokta0000000000000", "okta|dana"),
    );
    expect(created.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.federated,
    );
    expect(
      (
        await accounts.store.findByIssuerAndIdpId(
          "fis_01hzacmeokta0000000000000",
          "okta|dana",
        )
      )?.metadata?.id,
    ).toBe(created.metadata?.id);
    expect(await accounts.store.findDirectByIdpId("okta|dana")).toBeUndefined();
  });
});

describe("onComposed: the policy store binding under open source's own authorization", () => {
  it("hands open source's adapter over the composition's own store, so a row the grant path writes is the row the unit reads", async () => {
    let received: ComposedServices | undefined;
    const server = await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    const policies = received?.iamPolicies;
    if (policies === undefined) {
      throw new Error("the unit received no policy store");
    }
    const spec = create(IamPolicySpecSchema, {
      principal: { kind: "organization", id: "org_acme" },
      resource: { kind: "team", id: "tem_acme" },
      relation: "organization",
    });
    const id = policyIdFor(spec);
    await newResourceIamPolicyStore(server.store, { keepsHistory: false }).save(
      create(IamPolicySchema, { metadata: { id }, spec }),
    );

    expect(
      (await policies.findByResource("team", "tem_acme")).map(
        (policy) => policy.metadata?.id,
      ),
    ).toEqual([id]);
    expect((await policies.findScopeTuple("team", "tem_acme"))?.metadata?.id).toBe(
      id,
    );
    expect(
      (await policies.findByResourceKindAndRelation("team", "organization")).map(
        (policy) => policy.metadata?.id,
      ),
    ).toEqual([id]);
  });
});

describe("onComposed: which organization a resource belongs to", () => {
  it("answers a resource's organization from its row where no scope link names one, an organization itself, and nothing for a row the server does not hold", async () => {
    let received: ComposedServices | undefined;
    const server = await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    const ref = (kind: string, id: string) => create(ApiResourceRefSchema, { kind, id });
    const organizations = received?.resourceOrganizations;
    if (organizations === undefined) {
      throw new Error("the unit received no resource organizations");
    }
    await server.store.saveResource(
      ApiResourceKind.agent,
      "agt_acme",
      AgentSchema,
      create(AgentSchema, { metadata: { id: "agt_acme", org: "org_acme", slug: "helper" } }),
    );

    expect(await organizations.organizationOf(ref("agent", "agt_acme"))).toBe("org_acme");
    expect(await organizations.organizationOf(ref("organization", "org_acme"))).toBe(
      "org_acme",
    );
    expect(await organizations.organizationOf(ref("agent", "agt_nowhere"))).toBe("");
  });
});

describe("onComposed: the store's one name table", () => {
  it("hands the name table every chain claims in, so a unit's claim, over its own rows, is the one a lookup by name reads and a create meets", async () => {
    let received: ComposedServices | undefined;
    const server = await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    const names = received?.resourceNames;
    if (names === undefined) {
      throw new Error("the unit received no name table");
    }
    const team = create(TeamSchema, {
      metadata: { id: "tem_acme", org: "org_acme", slug: "platform", name: "Platform" },
    });
    const ctx = new RequestContext(TeamSchema, team, testCallerIdentity(), ApiResourceKind.team);
    await newClaimNameStep<typeof TeamSchema>(
      { resourceNames: names },
      ApiResourceKind.team,
      portHolder(async (id) => (id === "tem_acme" ? team : undefined)),
    ).execute(ctx);

    expect(
      await resolveName(server.store, ApiResourceKind.team, "org_acme", "platform"),
    ).toBe("tem_acme");
    const rival = new RequestContext(
      TeamSchema,
      create(TeamSchema, {
        metadata: { id: "tem_rival", org: "org_acme", slug: "platform", name: "Platform" },
      }),
      testCallerIdentity(),
      ApiResourceKind.team,
    );
    await expect(
      newClaimNameStep<typeof TeamSchema>(
        server.store,
        ApiResourceKind.team,
        portHolder(async () => team),
      ).execute(rival),
    ).rejects.toThrow("Team already exists: slug 'platform' in org 'org_acme' (id: tem_acme)");
  });
});

describe("start: a unit's boot work runs before anything serves", () => {
  it("runs each unit's start in unit order, before the server reports SERVING", async () => {
    const seen: string[] = [];
    let server: ComposedServer | undefined;
    const observe = (unit: string) => (): Promise<void> => {
      seen.push(
        `${unit}:${HealthCheckResponse_ServingStatus[server?.healthState.status("") ?? HealthCheckResponse_ServingStatus.UNKNOWN]}`,
      );
      return Promise.resolve();
    };
    server = await compose([
      enterpriseUnit({ start: observe("first") }),
      { name: "second", start: observe("second") },
    ]);
    await server.start();
    expect(seen).toEqual(["first:NOT_SERVING", "second:NOT_SERVING"]);
    expect(server.healthState.status("")).toBe(
      HealthCheckResponse_ServingStatus.SERVING,
    );
  });

  it("a failing start fails the server's start, naming its unit, and the server never reports SERVING", async () => {
    const server = await compose([
      enterpriseUnit({
        start: () => Promise.reject(new Error("repair failed")),
      }),
    ]);
    await expect(server.start()).rejects.toThrowError(
      "extension 'enterprise-fixture' failed to start: repair failed",
    );
    expect(server.healthState.status("")).toBe(
      HealthCheckResponse_ServingStatus.NOT_SERVING,
    );
  });
});

describe("an edition above open source signs its callers in", () => {
  it.each([
    ["on open source's own authorizer", {}],
    [
      "with its own Authorizer",
      { authorizer: newPermissiveSingleTeamAuthorizer() },
    ],
  ])(
    "refuses to boot trusted-local %s",
    async (_label, extra: Partial<ServerExtension>) => {
      await expect(
        compose([
          {
            name: "signed-out-enterprise",
            edition: ServerEdition.enterprise,
            ...extra,
          },
        ]),
      ).rejects.toThrowError(
        "the composition serves edition 'enterprise' without the require-authentication posture — an edition above open source must sign its callers in: declare requireAuthentication on a unit that registers a verifier, or configure STIGMER_OIDC_ISSUER",
      );
    },
  );
});
