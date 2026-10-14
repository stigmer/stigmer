/**
 * Pins the enterprise-identity unit's registrations, built the way any host
 * builds it: `newEnterpriseIdentityExtension` over ports alone, every one a
 * refusing double, so the build proves the unit constructs no adapter and
 * calls no port while it is assembled. A host's IAM unit hosts this unit
 * over its own adapters, and its own suites read and compose the two
 * together; this suite pins the unit as a library over its ports.
 *
 * What it registers, and nothing else: the federated verifier; the
 * IdentityFederation capability and the team principal display; the
 * removal on `org-delete:pre-delete`; the organization grant
 * gate on `iam-policy-create:pre-side-effect-gate`; the FederationIssuer,
 * Invitation and Team services; the row readers of its three kinds; the
 * hand-over, which refuses a composition with no list scope or no
 * authorization check; and the start its boot repairs run on. No removal
 * is the host's: the organization delete is the unit's own.
 *
 * The boot repair is pinned here too, run through the unit's start after
 * the hand-over, over fakes of the ports it reads and an in-process
 * organization and IamPolicy service (the transport the composition hands
 * it), because it is the one piece of
 * the domain whose failure is silent: an invitation or a team left
 * unlinked is invisible to its own organization's admins, and nothing
 * refuses. It runs providers, then invitations, then teams (the teams
 * through the in-memory store's `findAll`), each kind on its own, so a
 * failed read of one never skips the next, and the provider's log lines
 * keep their words.
 * The owner-row reconcile beside it runs the same way, one read of the
 * policy rows per kind, and logs every owner row it revokes with the
 * account the row named.
 *
 * The unit's authorization inventory,
 * docs/enterprise-authorization-coverage.md, is held to the services it
 * binds, over the same router replay: its rows are exactly the bound
 * methods; each row's annotation is the method's own (a `config` row's
 * permission, resource kind, target and copy included); every row that is
 * not `config` names its guard, its driver or why it is open by design; and
 * every guard it names is declared once in the three kinds' own code, or is
 * a step of `@stigmer/server`'s. An annotation changed, a method dropped or
 * a guard renamed without the inventory fails here. The doc and the kinds'
 * folders are found by their own paths.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { create, getOption, hasOption, type DescMessage, type DescMethod, type DescService } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createConnectRouter,
  createRouterTransport,
} from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { config, is_public, is_skip_authorization } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
  type IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import { FederationIssuerQueryController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/query_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import {
  OrganizationSchema,
  OrganizationStatusSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { createLogger } from "@stigmer/server";
import type {
  AuthorizationQueryEngine,
  ChildOrganizations,
  ComposedIamPolicies,
  ResourceOrganizations,
  ComposedIdentityAccounts,
  ComposedServices,
  CredentialBinding,
  ListReadScope,
  ServerExtension,
} from "@stigmer/server";
import { describe, expect, it } from "vitest";

import {
  REFUSING_AUTHORIZER,
  REFUSING_FETCH,
  refusingPort,
  SILENT_LOGGER,
} from "../../__test-utils__/refusing-doubles.js";
import { storedInvitation } from "../../iam/invitation/__tests__/in-memory-invitation-store.js";
import type { IdentityAccountService } from "../../iam/account/port.js";
import type { InvitationStore } from "../../iam/invitation/store.js";
import { InMemoryTeamStore, storedTeam } from "../../iam/team/__tests__/in-memory-team-store.js";
import type { TeamStore } from "../../iam/team/store.js";
import { storedIssuer } from "../../iam/issuer/__tests__/in-memory-issuer-store.js";
import type { FederationIssuerStore } from "../../iam/issuer/store.js";
import { newEnterpriseIdentityExtension } from "../enterprise-identity.js";
import type { ResourceNameStore } from "@stigmer/server";

const ENTERPRISE_SERVICES: ReadonlyArray<DescService> = [
  FederationIssuerCommandController,
  FederationIssuerQueryController,
  InvitationCommandController,
  InvitationQueryController,
  TeamCommandController,
  TeamQueryController,
];

function unit(): ServerExtension {
  return newEnterpriseIdentityExtension({
    providers: refusingPort("providers"),
    teams: refusingPort("teams"),
    invitations: refusingPort("invitations"),
    signInGrants: refusingPort("signInGrants"),
    accounts: refusingPort("accounts"),
    schema: refusingPort("schema"),
    outboundFetch: REFUSING_FETCH,
    reservedIssuers: [],
    logger: SILENT_LOGGER,
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The unit's authorization inventory, published beside the package. */
const COVERAGE_DOC = join(HERE, "../../../docs/enterprise-authorization-coverage.md");

/** The three kinds' own folders, whose non-test files declare the guards a row may name. */
const KIND_FOLDERS = ["issuer", "invitation", "team"].map((kind) => join(HERE, "../../iam", kind));

/** The installed library's `src/`, which declares the shared steps a row may name. */
const LIBRARY_SRC = join(dirname(createRequire(import.meta.url).resolve("@stigmer/server/package.json")), "src");

/** A row: `| Service.method | annotation | handler |`. */
const COVERAGE_ROW = /^\| ([A-Za-z]+)\.([A-Za-z]+) \| ([^|]+) \| (.*) \|$/;

const MARKERS = ["guard:", "driver:", "by design:"] as const;

interface CoverageRow {
  readonly method: string;
  readonly annotation: string;
  readonly handler: string;
}

function coverageRows(): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const line of readFileSync(COVERAGE_DOC, "utf8").split("\n")) {
    const m = COVERAGE_ROW.exec(line);
    if (m !== null) {
      rows.push({ method: `${m[1] ?? ""}.${m[2] ?? ""}`, annotation: (m[3] ?? "").trim(), handler: m[4] ?? "" });
    }
  }
  return rows;
}

/** The methods the unit binds, by replaying its registrations into a router. */
function boundMethods(): DescMethod[] {
  const router = createConnectRouter();
  for (const register of unit().services ?? []) {
    register(router);
  }
  return router.handlers.map((handler) => handler.method);
}

function rowKey(method: DescMethod): string {
  return `${method.parent.name}.${method.name}`;
}

/** A method's annotation as a row states it; a `config` one with its permission, resource kind, target and copy. */
function annotationOf(method: DescMethod): string {
  if (getOption(method, is_public)) {
    return "is_public";
  }
  if (getOption(method, is_skip_authorization)) {
    return "is_skip_authorization";
  }
  if (hasOption(method, config)) {
    const declared = getOption(method, config);
    const target = declared.fieldPath !== "" ? `field ${declared.fieldPath}` : `resource_id ${declared.resourceId}`;
    const copy = declared.errorMsg !== "" ? "yes" : "no";
    return `config: ${IamPermission[declared.permission]} on ${ApiResourceKind[declared.resourceKind]} (${target}), error_msg ${copy}`;
  }
  return "none";
}

/**
 * Whether a request type names an organization the way the library's
 * organization-name rule reads one (a string field `org` or ending `_org`,
 * or a repeated `orgs`, at any depth): such a request meets the library's
 * deleting rule before its handler.
 */
function namesAnOrganization(message: DescMessage, seen: Set<string> = new Set()): boolean {
  if (seen.has(message.typeName)) {
    return false;
  }
  seen.add(message.typeName);
  return message.fields.some((field) => {
    if (field.fieldKind === "scalar" || field.fieldKind === "list") {
      if (field.name === "org" || field.name.endsWith("_org") || field.name === "orgs") {
        return true;
      }
    }
    const child =
      field.fieldKind === "message"
        ? field.message
        : field.fieldKind === "list" && field.listKind === "message"
          ? field.message
          : undefined;
    return child !== undefined && namesAnOrganization(child, seen);
  });
}

/** Every non-test `.ts` file under `dir`. */
function sourcesUnder(dir: string): string[] {
  const texts: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") {
        texts.push(...sourcesUnder(path));
      }
    } else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
      texts.push(readFileSync(path, "utf8"));
    }
  }
  return texts;
}

/** How many times `texts` declare `guard`: a quoted step name, or a function, generic or not. */
function declarationsOf(guard: string, texts: ReadonlyArray<string>): number {
  const declared = new RegExp(`"${guard}"|\\bfunction ${guard}[(<]`, "g");
  return texts.reduce((count, text) => count + [...text.matchAll(declared)].length, 0);
}

/** What a composition that signs its callers in hands over; every member refuses a call. */
function refusingComposition(overrides: Partial<ComposedServices> = {}): ComposedServices {
  return {
    authorizer: REFUSING_AUTHORIZER,
    credentialBinding: refusingPort<CredentialBinding>("credentialBinding"),
    listReadScope: refusingPort<ListReadScope>("listReadScope"),
    authorizationQueries: refusingPort<Pick<AuthorizationQueryEngine, "check">>("authorizationQueries"),
    resourceAuthorizationLifecycle: undefined,
    childOrganizations: refusingPort<ChildOrganizations>("childOrganizations"),
    identityAccounts: refusingPort<ComposedIdentityAccounts>("identityAccounts"),
    iamPolicies: refusingPort<ComposedIamPolicies>("iamPolicies"),
    resourceOrganizations: refusingPort<ResourceOrganizations>("resourceOrganizations"),
    inProcessTransport: createRouterTransport(() => {}),
    resourceNames: refusingPort<ResourceNameStore>("resourceNames"),
    ...overrides,
  };
}

describe("the enterprise-identity unit", () => {
  it("is its own named unit", () => {
    expect(unit().name).toBe("enterprise-identity");
  });

  it("registers the federated lane as its one verifier", () => {
    expect(unit().identityVerifiers?.map((v) => v.name)).toEqual([
      "federated-idp",
    ]);
  });

  it("registers the federated arms as the IdentityFederation capability, the team principal display and its row readers, and no other driver", () => {
    const drivers = unit().drivers;
    expect(Object.keys(drivers ?? {}).sort()).toEqual([
      "identityFederation",
      "principalDisplay",
      "resourceRowReaders",
    ]);
    expect(typeof drivers?.identityFederation?.providerExists).toBe("function");
    expect(drivers?.principalDisplay).toBeDefined();
  });

  it("puts exactly one step, OrganizationGrantGate, on iam-policy-create:pre-side-effect-gate", () => {
    expect(
      unit()
        .gateSteps?.get("iam-policy-create:pre-side-effect-gate")
        ?.map((step) => step.name),
    ).toEqual(["OrganizationGrantGate"]);
  });

  it("puts exactly one step, the removal, on org-delete:pre-delete", () => {
    expect(
      unit()
        .gateSteps?.get("org-delete:pre-delete")
        ?.map((step) => step.name),
    ).toEqual(["RemoveOrganizationIdentity"]);
  });

  it("fills no other slot and guards no caller", () => {
    expect([...(unit().gateSteps?.keys() ?? [])].sort()).toEqual([
      "iam-policy-create:pre-side-effect-gate",
      "org-delete:pre-delete",
    ]);
    expect(unit().callerGuards ?? []).toHaveLength(0);
  });

  it("serves the FederationIssuer, Invitation and Team services, which open source does not, with every method bound", () => {
    const router = createConnectRouter();
    for (const register of unit().services ?? []) {
      register(router);
    }
    const served = router.handlers.map((handler) => handler.service.typeName);
    expect(new Set(served)).toEqual(
      new Set(ENTERPRISE_SERVICES.map((service) => service.typeName)),
    );
    for (const service of ENTERPRISE_SERVICES) {
      expect(
        served.filter((name) => name === service.typeName),
        `${service.typeName} routes`,
      ).toHaveLength(service.methods.length);
    }
  });

  it("tells the composition's own authorization where its three kinds' rows are, and nothing else", () => {
    expect([...(unit().drivers?.resourceRowReaders?.keys() ?? [])].sort()).toEqual(
      [ApiResourceKind.federation_issuer, ApiResourceKind.invitation, ApiResourceKind.team].sort(),
    );
  });

  it("takes the composition's services on its hand-over and runs its boot repairs on start", () => {
    const built = unit();
    expect(typeof built.onComposed).toBe("function");
    expect(typeof built.start).toBe("function");
    expect(() => built.onComposed?.(refusingComposition())).not.toThrow();
  });

  it("lists exactly the methods it binds in its authorization inventory", () => {
    const bound = boundMethods().map(rowKey).sort();
    expect(bound.length, "bound methods (an empty replay proves nothing)").toBe(
      ENTERPRISE_SERVICES.reduce((total, service) => total + service.methods.length, 0),
    );
    expect(coverageRows().map((row) => row.method).sort()).toEqual(bound);
  });

  it("states each method's own annotation in its inventory row, a config row's permission, resource kind, target and copy included", () => {
    const rows = new Map(coverageRows().map((row) => [row.method, row.annotation]));
    const wrong = boundMethods()
      .map((method) => ({ key: rowKey(method), declared: annotationOf(method) }))
      .filter(({ key, declared }) => rows.get(key) !== declared)
      .map(({ key, declared }) => `${key} declares ${declared}, its row states ${rows.get(key) ?? "nothing"}`);
    expect(wrong).toEqual([]);
  });

  it("names, on every inventory row that is not config, its guard, its driver or why it is open by design", () => {
    const bare = coverageRows()
      .filter((row) => !row.annotation.startsWith("config: "))
      .filter((row) => !MARKERS.some((marker) => row.handler.includes(marker)))
      .map((row) => row.method);
    expect(bare).toEqual([]);
  });

  it("says, on every row that is not config and names no organization, how an organization being deleted is refused there", () => {
    const methods = new Map(boundMethods().map((method) => [rowKey(method), method]));
    const unmarked = coverageRows()
      .filter((row) => !row.annotation.startsWith("config: "))
      .filter((row) => {
        const method = methods.get(row.method);
        return method !== undefined && !namesAnOrganization(method.input);
      })
      .filter((row) => !row.handler.includes("deleting: "))
      .map((row) => row.method);
    expect(unmarked).toEqual([]);
    const own = KIND_FOLDERS.flatMap(sourcesUnder);
    const library = sourcesUnder(LIBRARY_SRC);
    const dangling = coverageRows()
      .flatMap((row) =>
        [...row.handler.matchAll(/deleting: ([A-Za-z]+)/g)].map((m) => ({ method: row.method, guard: m[1] ?? "" })),
      )
      .filter(({ guard }) => guard !== "inert")
      .filter(({ guard }) => declarationsOf(guard, own) === 0 && declarationsOf(guard, library) === 0)
      .map(({ method, guard }) => `${method} names ${guard}, declared nowhere`);
    expect(dangling).toEqual([]);
  });

  it("names only guards declared once in the three kinds' own code, or steps of the library's", () => {
    const own = KIND_FOLDERS.flatMap(sourcesUnder);
    const library = sourcesUnder(LIBRARY_SRC);
    const guards = coverageRows().flatMap((row) =>
      [...row.handler.matchAll(/guard: ([A-Za-z]+)/g)].map((m) => ({ method: row.method, guard: m[1] ?? "" })),
    );
    expect(guards.length, "guards named (an inventory naming none proves nothing)").toBeGreaterThan(0);
    const dangling = guards
      .map(({ method, guard }) => ({ method, guard, here: declarationsOf(guard, own) }))
      .filter(({ guard, here }) => here > 1 || (here === 0 && declarationsOf(guard, library) === 0))
      .map(({ method, guard, here }) =>
        here > 1 ? `${method} names guard ${guard}, declared ${here} times` : `${method} names guard ${guard}, declared nowhere`,
      );
    expect(dangling).toEqual([]);
  });

  it.each([
    ["no list read scope", { listReadScope: undefined }, "list read scope"],
    ["no authorization check", { authorizationQueries: undefined }, "authorization check"],
  ] as const)(
    "refuses a composition with %s: its lists and gates would answer nobody's question",
    (_label, overrides, missing) => {
      expect(() => unit().onComposed?.(refusingComposition(overrides))).toThrowError(
        `the enterprise-identity unit needs a composition that signs its callers in: it has no ${missing} to narrow its lists and check its grants with`,
      );
    },
  );
});

/** A port whose given members answer; every other member refuses, as refusingPort's do. */
function portWith<T extends object>(name: string, members: Partial<T>): T {
  const refusing = refusingPort<T>(name);
  // The proxy completes the partial: a member not given is the refusing
  // port's, so the assertion to T is what the proxy serves.
  return new Proxy(members, {
    get: (target, member) =>
      member in target ? Reflect.get(target, member) : Reflect.get(refusing, member),
  }) as T;
}

/** When `acme`, the one organization the in-process service knows, was created; every other id is NOT_FOUND. */
const ACME_CREATED = new Date("2026-09-01T00:00:00Z");

function repairRig(rows: {
  providers: () => Promise<ReadonlyArray<FederationIssuer>>;
  invitations: ReadonlyArray<Invitation>;
  /** Teams, read through the in-memory store's `findAll`; none when absent. */
  teams?: ReadonlyArray<Team>;
  /** The invitations' read fails. */
  failInvitationsRead?: boolean;
  failGrantFor?: ReadonlySet<string>;
  /** The policy rows each row holds as resource, by id. */
  policiesOn?: ReadonlyMap<string, ReadonlyArray<IamPolicy>>;
  /** Kinds whose read by kind and relation fails. */
  failKindReadFor?: ReadonlySet<string>;
  /** The schema chain fails. */
  failSchema?: boolean;
}) {
  const granted: string[] = [];
  const revoked: string[] = [];
  const logged: Array<Record<string, unknown>> = [];
  // The in-process transport the composition hands the unit: the
  // organization read the repair's creation times come from, and the
  // grant path's two commands the repair and the reconcile write through.
  const transport = createRouterTransport(({ service }) => {
    service(OrganizationQueryController, {
      get: (request) => {
        if (request.value !== "acme") {
          throw new ConnectError("organization not found", Code.NotFound);
        }
        const stamp = timestampFromDate(ACME_CREATED);
        return create(OrganizationSchema, {
          metadata: create(ApiResourceMetadataSchema, { id: "acme", slug: "acme", name: "Acme" }),
          status: create(OrganizationStatusSchema, {
            audit: create(ApiResourceAuditSchema, {
              specAudit: create(ApiResourceAuditInfoSchema, { createdAt: stamp, updatedAt: stamp }),
            }),
          }),
        });
      },
    });
    service(IamPolicyCommandController, {
      bootstrapPolicy: (spec: IamPolicySpec) => {
        const id = spec.resource?.id ?? "";
        granted.push(`${spec.resource?.kind}:${id}`);
        if (rows.failGrantFor?.has(id) === true) {
          throw new ConnectError("engine down", Code.Unavailable);
        }
        return create(IamPolicySchema);
      },
      delete: (spec: IamPolicySpec) => {
        revoked.push(`${spec.resource?.kind}:${spec.resource?.id}#${spec.relation}@${spec.principal?.id}`);
        return create(IamPolicySchema, { spec });
      },
    });
  });
  const teamStore = new InMemoryTeamStore();
  for (const team of rows.teams ?? []) {
    void teamStore.insert(team);
  }
  const unit = newEnterpriseIdentityExtension({
    providers: portWith<FederationIssuerStore>("providers", {
      findAll: rows.providers,
    }),
    teams: portWith<TeamStore>("teams", {
      findAll: () => teamStore.findAll(),
    }),
    invitations: portWith<InvitationStore>("invitations", {
      findAll: () =>
        rows.failInvitationsRead === true
          ? Promise.reject(new Error("store down"))
          : Promise.resolve(rows.invitations),
    }),
    signInGrants: refusingPort("signInGrants"),
    accounts: refusingPort("accounts"),
    schema: { ensure: () => (rows.failSchema === true ? Promise.reject(new Error("schema down")) : Promise.resolve()) },
    outboundFetch: REFUSING_FETCH,
    reservedIssuers: [],
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line: string) => {
        logged.push(JSON.parse(line) as Record<string, unknown>);
      },
    }),
  });
  const iamPolicies: ComposedIamPolicies = {
      findScopeTuple: () => Promise.resolve(undefined),
      findByResource: (_kind: string, id: string) => Promise.resolve(rows.policiesOn?.get(id) ?? []),
      findByResourceKindAndRelation: (kind: string, relation: string) =>
        rows.failKindReadFor?.has(kind) === true
          ? Promise.reject(new Error("store down"))
          : Promise.resolve(
              [...(rows.policiesOn?.values() ?? [])]
                .flat()
                .filter((p) => p.spec?.resource?.kind === kind && p.spec?.relation === relation),
            ),
  };
  unit.onComposed?.(refusingComposition({ inProcessTransport: transport, iamPolicies }));
  /** The unit's boot work, as the server's start runs it. */
  const start = async (): Promise<void> => {
    if (unit.start === undefined) {
      throw new Error("the unit registers no start");
    }
    await unit.start();
  };
  return { start, granted, revoked, logged };
}

/** A direct owner row, as the creation event wrote one before the kinds recorded no owner. */
function ownerRow(kind: string, id: string, accountId: string): IamPolicy {
  return create(IamPolicySchema, {
    spec: create(IamPolicySpecSchema, {
      principal: create(ApiResourceRefSchema, { kind: "identity_account", id: accountId }),
      relation: "owner",
      resource: create(ApiResourceRefSchema, { kind, id }),
    }),
  });
}

describe("the unit's start", () => {
  it("makes its schema current first, and a schema that fails stops the start before any repair", async () => {
    const r = repairRig({
      providers: () =>
        Promise.resolve([storedIssuer({ id: "fis_acme", org: "acme", slug: "acme-idp" })]),
      invitations: [],
      policiesOn: new Map([["fis_acme", [ownerRow("federation_issuer", "fis_acme", "ida_carol")]]]),
      failSchema: true,
    });

    await expect(r.start()).rejects.toThrow("schema down");
    expect(r.granted).toEqual([]);
    expect(r.revoked).toEqual([]);
  });
});

describe("the owner-row reconcile", () => {
  it("revokes every provider's, then every invitation's, direct owner row, and logs each with its account", async () => {
    const r = repairRig({
      providers: () =>
        Promise.resolve([storedIssuer({ id: "fis_acme", org: "acme", slug: "acme-idp" })]),
      invitations: [storedInvitation({ id: "inv_acme", org: "acme", token: "AcmeToken" })],
      policiesOn: new Map([
        ["fis_acme", [ownerRow("federation_issuer", "fis_acme", "ida_carol")]],
        ["inv_acme", [ownerRow("invitation", "inv_acme", "ida_carl")]],
      ]),
    });

    await r.start();

    expect(r.revoked).toEqual([
      "federation_issuer:fis_acme#owner@ida_carol",
      "invitation:inv_acme#owner@ida_carl",
    ]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        message: "federation-issuer owner row revoked; its organization's admins manage it",
        provider: "fis_acme",
        account: "ida_carol",
      }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        message: "invitation owner row revoked; its organization's admins manage it",
        invitation: "inv_acme",
        account: "ida_carl",
      }),
    );
  });

  it("still revokes the invitations' rows when the providers' owner rows cannot be read", async () => {
    const r = repairRig({
      providers: () => Promise.resolve([]),
      invitations: [],
      policiesOn: new Map([
        ["fis_acme", [ownerRow("federation_issuer", "fis_acme", "ida_carol")]],
        ["inv_acme", [ownerRow("invitation", "inv_acme", "ida_carl")]],
      ]),
      failKindReadFor: new Set(["federation_issuer"]),
    });

    await r.start();

    expect(r.revoked).toEqual(["invitation:inv_acme#owner@ida_carl"]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "federation-issuer owner-row reconcile failed",
        error: "store down",
      }),
    );
  });
});

describe("the boot repair", () => {
  it("links every provider, then every invitation, then every team missing its organization link, and counts each kind", async () => {
    const r = repairRig({
      providers: () =>
        Promise.resolve([storedIssuer({ id: "fis_acme", org: "acme", slug: "acme-idp" })]),
      invitations: [storedInvitation({ id: "inv_acme", org: "acme", token: "AcmeToken" })],
      teams: [storedTeam({ id: "tm_acme", org: "acme", slug: "acme-team" })],
    });

    await r.start();

    expect(r.granted).toEqual([
      "federation_issuer:fis_acme",
      "invitation:inv_acme",
      "team:tm_acme",
    ]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({ message: "team organization links converged", count: 1 }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({ message: "federation-issuer organization links converged", count: 1 }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({ message: "invitation organization links converged", count: 1 }),
    );
  });

  it("still links the invitations when the providers cannot be read", async () => {
    const r = repairRig({
      providers: () => Promise.reject(new Error("store down")),
      invitations: [storedInvitation({ id: "inv_acme", org: "acme", token: "AcmeToken" })],
    });

    await r.start();

    expect(r.granted).toEqual(["invitation:inv_acme"]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "federation-issuer organization-link reconcile failed",
        error: "store down",
      }),
    );
  });

  it("still links the teams when the invitations cannot be read", async () => {
    const r = repairRig({
      providers: () => Promise.resolve([]),
      invitations: [],
      failInvitationsRead: true,
      teams: [storedTeam({ id: "tm_acme", org: "acme", slug: "acme-team" })],
    });

    await r.start();

    expect(r.granted).toEqual(["team:tm_acme"]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "invitation organization-link reconcile failed",
        error: "store down",
      }),
    );
  });

  it("names each row it leaves alone or cannot link, in the provider's words from before invitations joined", async () => {
    const r = repairRig({
      providers: () =>
        Promise.resolve([
          storedIssuer({ id: "fis_gone", org: "gone", slug: "gone-idp" }),
          storedIssuer({ id: "fis_down", org: "acme", slug: "down-idp" }),
        ]),
      invitations: [storedInvitation({ id: "inv_gone", org: "gone", token: "GoneToken" })],
      failGrantFor: new Set(["fis_down"]),
    });

    await r.start();

    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message:
          "federation issuer left without its organization link; nobody can manage it until a hand decides",
        provider: "fis_gone",
        org: "gone",
        reason: "organization-gone",
      }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "federation-issuer organization link could not converge",
        provider: "fis_down",
        error: "[unavailable] engine down",
      }),
    );
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message:
          "invitation left without its organization link; nobody can manage it until a hand decides",
        invitation: "inv_gone",
        org: "gone",
        reason: "organization-gone",
      }),
    );
  });

  it("names a team it leaves alone, since nobody can manage it", async () => {
    const r = repairRig({
      providers: () => Promise.resolve([]),
      invitations: [],
      teams: [storedTeam({ id: "tm_gone", org: "gone", slug: "gone-team" })],
    });

    await r.start();

    expect(r.granted).toEqual([]);
    expect(r.logged).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message:
          "team left without its organization link; nobody can manage it until a hand decides",
        team: "tm_gone",
        org: "gone",
        reason: "organization-gone",
      }),
    );
  });
});
