/**
 * The Team RPCs over a router transport with the serving chain's identity
 * stamp, an in-memory store, a recording
 * authorizer and recording lifecycle and removal fakes, so every chain
 * runs as production runs it.
 *
 * Pins, in the order a reviewer would ask:
 *   - create shapes the envelope the OSS way (a `tm_` id, the slug derived
 *     from the name, the audit stamped for the caller), writes the row,
 *     then fires the creation event: the organization link alone, no
 *     owner, no visibility tuple;
 *   - a slug held in the organization is ALREADY_EXISTS with the OSS copy,
 *     from the pre-check and from the name claim's race alike; a row the
 *     server's name table never held is still refused by the table's unique
 *     index, and the failed create lets its claim go; the same slug in
 *     another organization is fine;
 *   - a failed creation event is the OSS step's INTERNAL, with the row
 *     left in place (the lifecycle contract every create follows);
 *   - update replaces what a client may change and keeps what it may not
 *     (id, slug, organization, the creation audit), through the OSS
 *     BuildUpdateState;
 *   - delete goes through the removal and answers the team; an unknown id
 *     is NOT_FOUND and removes nothing; a failed removal fails the delete;
 *   - getByReference authorizes the loaded team exactly as `get` would,
 *     with `get`'s copy on a denial, and answers a missing slug NOT_FOUND
 *     only to a viewer of the organization and `get`'s denial to anyone
 *     else, after asking only the organization's `can_view`;
 *   - list answers the organization's teams, newest first, a page and a
 *     token at a time to the end, 50 at size 0, and refuses a token issued
 *     for another organization;
 *   - rename asks can_delete on the team, keeps its id, moves its name so
 *     the old slug still leads to it and is refused to a create with
 *     SLUG_RESERVED, takes its old slug back, and stamps the audit; an
 *     update that loaded the team before a rename keeps the new slug.
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type Interceptor,
} from "@connectrpc/connect";
import type {
  Authorizer,
  AuthzCheck,
  Logger,
  ResourceCreatedEvent,
} from "@stigmer/server";
import { callerIdentityKey, createLogger, RequestContext } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import type { Team } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/apis/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/apis/ai/stigmer/iam/team/v1/query_pb";
import { TeamSpecSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/spec_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { newTeamServiceRegistrations, type TeamLaneDeps } from "../handlers.js";
import type { TeamInsertOutcome } from "../store.js";
import { InMemoryTeamStore, storedTeam } from "./in-memory-team-store.js";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { inMemoryNames, nameOrganization } from "../../../__test-utils__/in-memory-names.js";
import { newLoadTeamByReferenceStep } from "../steps.js";
import type { InMemoryNames } from "../../../__test-utils__/in-memory-names.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../__test-utils__/unbound-credential-binding.js";

const ADMIN = "ida_admin";

const silent: Logger = createLogger({ level: "error", pretty: false, write: () => {} });

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
  readonly commands: ReturnType<typeof createClient<typeof TeamCommandController>>;
  readonly queries: ReturnType<typeof createClient<typeof TeamQueryController>>;
  readonly teams: InMemoryTeamStore;
  readonly names: InMemoryNames;
  /** Stores a team as its create chain would: its row, and its slug as its name. */
  seed(team: Team): Promise<void>;
  readonly checks: AuthzCheck[];
  readonly created: ResourceCreatedEvent[];
  readonly removed: string[];
}

function rig(
  options: {
    decide?: (check: AuthzCheck) => "allow" | "deny";
    teams?: InMemoryTeamStore;
    names?: InMemoryNames;
    onCreated?: () => Promise<void>;
    onRemove?: () => Promise<void>;
    planGate?: TeamLaneDeps["planGate"];
  } = {},
): Rig {
  const teams = options.teams ?? new InMemoryTeamStore();
  const names = options.names ?? inMemoryNames();
  const checks: AuthzCheck[] = [];
  const created: ResourceCreatedEvent[] = [];
  const removed: string[] = [];
  const authorizer: Authorizer = {
    authorize: (_caller, check) => {
      checks.push(check);
      const decision = options.decide?.(check) ?? "allow";
      return Promise.resolve(
        decision === "allow" ? { kind: "allow" } : { kind: "deny", reason: "" },
      );
    },
  };
  const deps: TeamLaneDeps = {
    authorizer,
    credentialBinding: UNBOUND_CREDENTIAL_BINDING,
    logger: silent,
    teams,
    names,
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
    ...(options.planGate === undefined ? {} : { planGate: options.planGate }),
  };
  const transport = createRouterTransport(
    (router) => {
      for (const register of newTeamServiceRegistrations(deps)) {
        register(router);
      }
    },
    { router: { interceptors: [identityInterceptor()] } },
  );
  return {
    commands: createClient(TeamCommandController, transport),
    queries: createClient(TeamQueryController, transport),
    teams,
    names,
    async seed(team: Team): Promise<void> {
      await teams.insert(team);
      const metadata = team.metadata!;
      await names.resourceNames.claim(
        { kind: "team", org: metadata.org, name: metadata.slug },
        metadata.id,
        new Date().toISOString(),
      );
    },
    checks,
    created,
    removed,
  };
}

/** The message the generated SDK client sends for a new team. */
function newTeam(name: string, org = "acme"): Team {
  return create(TeamSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Team",
    metadata: create(ApiResourceMetadataSchema, { name, org }),
    spec: create(TeamSpecSchema, { description: "keeps production up" }),
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

describe("create", () => {
  it("shapes the envelope the OSS way, writes the row, then fires the organization link alone", async () => {
    const r = rig();
    const team = await r.commands.create(newTeam("Site Reliability"));

    expect(team.metadata?.id).toMatch(/^tm_[0-9a-z]{26}$/);
    expect(team.metadata?.slug).toBe("site-reliability");
    expect(team.status?.audit?.specAudit?.createdBy?.id).toBe(ADMIN);
    expect(await r.teams.findById(team.metadata?.id ?? "")).toEqual(team);

    expect(r.checks[0]).toEqual({
      permission: IamPermission.can_create_team,
      resourceKind: ApiResourceKind.organization,
      resourceId: "acme",
    });
    expect(r.created).toHaveLength(1);
    const event = r.created[0]!;
    expect(event.kind).toBe(ApiResourceKind.team);
    expect(event.resourceId).toBe(team.metadata?.id);
    expect(event.orgId).toBe("acme");
    expect(event.ownerAttribution).toBe(OwnerAttributionType.NONE);
    expect(event.requiresCreatorTuple).toBe(false);
    expect(event.visibilityShapes).toEqual([]);
    expect(event.parentLinks).toEqual([
      {
        parentKind: ApiResourceKind.organization,
        parentId: "acme",
        relation: "organization",
      },
    ]);
  });

  it("refuses a slug the organization holds with the OSS copy, naming the organization by its slug, and allows it in another organization", async () => {
    const r = rig();
    await nameOrganization(r.names, "acme", "acme-corp");
    const first = await r.commands.create(newTeam("SRE"));

    const refused = await failure(r.commands.create(newTeam("SRE")));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(
      `Team already exists: slug 'sre' in org 'acme-corp' (id: ${first.metadata?.id ?? ""})`,
    );

    const elsewhere = await r.commands.create(newTeam("SRE", "other"));
    expect(elsewhere.metadata?.slug).toBe("sre");
  });

  it("answers the same copy when the name claim loses the race the pre-check could not see", async () => {
    const names = inMemoryNames();
    await nameOrganization(names, "acme", "acme-corp");
    const claim = names.resourceNames.claim;
    const racing: InMemoryNames = {
      entries: names.entries,
      resourceNames: {
        ...names.resourceNames,
        claim: async (key, id, now) => {
          await claim(key, "tm_winner", now);
          return claim(key, id, now);
        },
      },
    };
    const teams = new InMemoryTeamStore();
    await teams.insert(storedTeam({ id: "tm_winner", org: "acme", slug: "sre" }));
    const r = rig({ teams, names: racing });

    const refused = await failure(r.commands.create(newTeam("SRE")));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(
      "Team already exists: slug 'sre' in org 'acme-corp' (id: tm_winner)",
    );
    expect(r.created).toEqual([]);
  });

  it("refuses a slug a row the name table never held, by the table's unique index, and lets its claim go", async () => {
    class UnnamedRowStore extends InMemoryTeamStore {
      override async insert(team: Team): Promise<TeamInsertOutcome> {
        await super.insert(storedTeam({ id: "tm_unnamed", org: "acme", slug: "sre" }));
        return super.insert(team);
      }
    }
    const r = rig({ teams: new UnnamedRowStore() });

    const refused = await failure(r.commands.create(newTeam("SRE")));
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage, "the holder the table never named goes unnamed, never the caller's own id").toBe(
      "Team already exists: slug 'sre' in org 'acme'",
    );
    expect(r.created).toEqual([]);
    expect([...r.names.entries.values()], "the failed create's claim is let go").toEqual([]);
  });

  it("fails as INTERNAL when the creation event fails, with the row left in place", async () => {
    const r = rig({ onCreated: () => Promise.reject(new Error("engine down")) });

    const failed = await failure(r.commands.create(newTeam("SRE")));
    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe("failed to create authorization tuples");
    expect(r.teams.inOrg("acme").map((team) => team.metadata?.slug)).toContain("sre");
  });

  it("refuses a team in an organization whose plan lacks teams, writing nothing, and creates one where it has them", async () => {
    const asked: string[] = [];
    const r = rig({
      planGate: {
        allowsTeams: (orgId) => {
          asked.push(orgId);
          return Promise.resolve(orgId === "paying");
        },
      },
    });

    const refused = await failure(r.commands.create(newTeam("SRE")));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "Organization 'acme' is on a plan without teams; it keeps its existing teams. Upgrade its plan to create a team or add a member.",
    );
    expect(refused.findDetails(ErrorInfoSchema).map((info) => [info.reason, info.metadata])).toEqual([
      ["PLAN_UPGRADE_REQUIRED", { feature: "teams", org: "acme" }],
    ]);
    expect(r.teams.inOrg("acme")).toEqual([]);
    expect(r.created).toEqual([]);

    expect((await r.commands.create(newTeam("SRE", "paying"))).metadata?.org).toBe("paying");
    expect(asked).toEqual(["acme", "paying"]);
  });

  it("writes nothing when the caller may not create teams", async () => {
    const r = rig({ decide: () => "deny" });

    const denied = await failure(r.commands.create(newTeam("SRE")));
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to create team in this organization");
    expect(r.teams.inOrg("acme")).toEqual([]);
    expect(r.created).toEqual([]);
  });
});

describe("rename", () => {
  it("asks can_delete on the team, keeps its id, and leaves the old slug leading to it", async () => {
    const r = rig();
    const created = await r.commands.create(newTeam("SRE"));
    const id = created.metadata?.id ?? "";

    const renamed = await r.commands.rename({ resourceId: id, slug: "site-reliability" });
    expect(renamed.metadata?.id).toBe(id);
    expect(renamed.metadata?.slug).toBe("site-reliability");
    expect(renamed.status?.audit?.specAudit?.event).toBe("renamed");
    expect(r.checks.at(-1)).toEqual({ permission: IamPermission.can_delete, resourceKind: ApiResourceKind.team, resourceId: id });
    expect((await r.teams.findById(id))?.metadata?.slug).toBe("site-reliability");

    const byOld = await r.queries.getByReference(create(ApiResourceReferenceSchema, { org: "acme", slug: "sre" }));
    expect(byOld.metadata?.id).toBe(id);
    expect(byOld.metadata?.slug).toBe("site-reliability");

    const reserved = await failure(r.commands.create(newTeam("SRE")));
    expect(reserved.code).toBe(Code.AlreadyExists);
    expect(reserved.findDetails(ErrorInfoSchema)[0]?.reason).toBe("SLUG_RESERVED");

    const back = await r.commands.rename({ resourceId: id, slug: "sre" });
    expect(back.metadata?.slug).toBe("sre");
  });

  it("is refused to a caller who may not delete the team, moving nothing", async () => {
    const r = rig({ decide: (check) => (check.permission === IamPermission.can_delete ? "deny" : "allow") });
    const created = await r.commands.create(newTeam("SRE"));
    const refused = await failure(r.commands.rename({ resourceId: created.metadata?.id ?? "", slug: "other" }));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect((await r.teams.findById(created.metadata?.id ?? ""))?.metadata?.slug).toBe("sre");
  });

  it("an update that loaded the team before a rename loses its swap, runs again, and keeps the new slug", async () => {
    const teams = new InMemoryTeamStore();
    let renameMidWrite: (() => Promise<unknown>) | undefined;
    let swaps = 0;
    const racing = Object.assign(Object.create(teams) as InMemoryTeamStore, {
      swap: async (id: string, expectedBytes: Uint8Array, team: Team) => {
        swaps += 1;
        const rename = renameMidWrite;
        renameMidWrite = undefined;
        await rename?.();
        return teams.swap(id, expectedBytes, team);
      },
    });
    const r = rig({ teams: racing });
    const created = await r.commands.create(newTeam("SRE"));
    const id = created.metadata?.id ?? "";
    renameMidWrite = () => r.commands.rename({ resourceId: id, slug: "site-reliability" });

    const updated = await r.commands.update(
      { resource: create(TeamSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "Team",
        metadata: create(ApiResourceMetadataSchema, { id, name: "SRE", slug: "sre", org: "acme" }),
        spec: create(TeamSpecSchema, { description: "edited mid-rename" }),
      }), updateMask: { paths: ["*"] } },
    );

    expect(renameMidWrite, "the rename landed mid-write").toBeUndefined();
    expect(swaps, "the lost swap ran again from a fresh read").toBe(2);
    expect(updated.metadata?.slug).toBe("site-reliability");
    const row = await teams.findById(id);
    expect(row?.metadata?.slug).toBe("site-reliability");
    expect(row?.spec?.description).toBe("edited mid-rename");
    expect((await r.names.resourceNames.current("team", "acme", id))?.name).toBe("site-reliability");
  });
});

describe("update", () => {
  it("replaces what a client may change and keeps the id, slug, organization and creation audit", async () => {
    const r = rig();
    const created = await r.commands.create(newTeam("SRE"));
    const id = created.metadata?.id ?? "";

    const updated = await r.commands.update(
      { resource: create(TeamSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "Team",
        metadata: create(ApiResourceMetadataSchema, {
          id,
          name: "Site Reliability",
          slug: "renamed",
          org: "acme",
        }),
        spec: create(TeamSpecSchema, { description: "on call for production" }),
      }), updateMask: { paths: ["*"] } },
    );

    expect(updated.metadata?.name).toBe("Site Reliability");
    expect(updated.metadata?.slug).toBe("sre");
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.description).toBe("on call for production");
    expect(updated.status?.audit?.specAudit?.createdAt).toEqual(
      created.status?.audit?.specAudit?.createdAt,
    );
    expect(r.checks.at(-1)).toEqual({
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.team,
      resourceId: id,
    });
    expect(await r.teams.findById(id)).toEqual(updated);
  });

  it("is NOT_FOUND for a team that does not exist", async () => {
    const r = rig();
    const missing = await failure(
      r.commands.update(
        { resource: create(TeamSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "Team",
          metadata: create(ApiResourceMetadataSchema, { id: "tm_gone", name: "x", org: "acme" }),
        }), updateMask: { paths: ["*"] } },
      ),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe("Team not found: tm_gone");
  });
});

describe("delete", () => {
  it("goes through the removal and answers the team", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));

    const deleted = await r.commands.delete({ resourceId: "tm_sre" });
    expect(deleted.metadata?.id).toBe("tm_sre");
    expect(r.removed).toEqual(["tm_sre"]);
    expect(r.checks.at(-1)).toEqual({
      permission: IamPermission.can_delete,
      resourceKind: ApiResourceKind.team,
      resourceId: "tm_sre",
    });
  });

  it("is NOT_FOUND for an unknown team and removes nothing", async () => {
    const r = rig();
    const missing = await failure(r.commands.delete({ resourceId: "tm_gone" }));
    expect(missing.code).toBe(Code.NotFound);
    expect(r.removed).toEqual([]);
  });

  it("fails when the removal fails", async () => {
    const r = rig({ onRemove: () => Promise.reject(new Error("engine down")) });
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));

    const failed = await failure(r.commands.delete({ resourceId: "tm_sre" }));
    expect(failed.code).toBe(Code.Internal);
  });
});

describe("reads", () => {
  it("get answers the team and NOT_FOUND for an unknown id", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));

    expect((await r.queries.get({ value: "tm_sre" })).metadata?.slug).toBe("sre");
    const missing = await failure(r.queries.get({ value: "tm_gone" }));
    expect(missing.code).toBe(Code.NotFound);
  });

  it("getByReference authorizes the loaded team exactly as get does", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));

    const team = await r.queries.getByReference({ org: "acme", slug: "sre" });
    expect(team.metadata?.id).toBe("tm_sre");
    expect(r.checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.team,
        resourceId: "tm_sre",
      },
    ]);
  });

  it("getByReference refuses an outsider with get's copy whether or not the slug exists, and names what a reference is missing", async () => {
    const r = rig({ decide: () => "deny" });
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));

    const denied = await failure(r.queries.getByReference({ org: "acme", slug: "sre" }));
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to view team");

    const unknown = await failure(r.queries.getByReference({ org: "acme", slug: "ops" }));
    expect(unknown.code).toBe(Code.PermissionDenied);
    expect(unknown.rawMessage).toBe("unauthorized to view team");
    expect(r.checks).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.team, resourceId: "tm_sre" },
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);

    const noOrg = await failure(r.queries.getByReference({ org: "", slug: "sre" }));
    expect(noOrg.code).toBe(Code.InvalidArgument);
    expect(noOrg.rawMessage).toBe("org is required for Team lookup");
  });

  it("getByReference refuses an outsider with get's copy whether the id is the organization's, another organization's or none", async () => {
    const r = rig({ decide: () => "deny" });
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));
    await r.seed(storedTeam({ id: "tm_x", org: "other", slug: "x" }));

    for (const id of ["tm_sre", "tm_x", "tm_gone"]) {
      const refused = await failure(r.queries.getByReference({ org: "acme", id }));
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe("unauthorized to view team");
    }
    expect(r.checks).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.team, resourceId: "tm_sre" },
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);
  });

  it("getByReference answers a missing slug NOT_FOUND to a viewer of the organization", async () => {
    const r = rig();
    const unknown = await failure(r.queries.getByReference({ org: "acme", slug: "ops" }));
    expect(unknown.code).toBe(Code.NotFound);
    expect(unknown.rawMessage).toBe("Team not found: ops");
    expect(r.checks).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);
  });

  it("getByReference reads a team by its id, and never asks the name table about a slug beside it", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_sre", org: "acme", slug: "sre" }));
    await r.seed(storedTeam({ id: "tm_ops", org: "acme", slug: "ops" }));

    expect((await r.queries.getByReference({ org: "acme", id: "tm_sre" })).metadata?.slug).toBe("sre");
    // "ops" names another team; beside an id the slug is not looked up, so
    // the answer says nothing of which names the organization holds.
    expect((await r.queries.getByReference({ org: "acme", id: "tm_sre", slug: "ops" })).metadata?.id).toBe("tm_sre");
  });

  it("getByReference by id answers a team of another organization, or none, as missing, and asks for an id or a slug", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_x", org: "other", slug: "x" }));

    const elsewhere = await failure(r.queries.getByReference({ org: "acme", id: "tm_x" }));
    expect(elsewhere.code).toBe(Code.NotFound);
    expect(elsewhere.rawMessage).toBe("Team not found: tm_x");
    const gone = await failure(r.queries.getByReference({ org: "acme", id: "tm_gone" }));
    expect(gone.rawMessage).toBe("Team not found: tm_gone");
    // Each miss is answered only after the organization's bar, as a slug's is.
    expect(r.checks).toEqual([
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
      { permission: IamPermission.can_view, resourceKind: ApiResourceKind.organization, resourceId: "acme" },
    ]);

    // An empty reference is the contract's own refusal over the wire, and the
    // step's guard for an in-process caller that skips the contract.
    const nothing = await failure(r.queries.getByReference({ org: "acme" }));
    expect(nothing.code).toBe(Code.InvalidArgument);
    expect(nothing.rawMessage).toBe("a reference names its resource by id or by slug [reference.id_or_slug]");
    const step = newLoadTeamByReferenceStep(inMemoryNames(), new InMemoryTeamStore(), { authorize: async () => ({ kind: "allow" as const }) });
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

  it("list answers the organization's teams, newest first", async () => {
    const r = rig();
    await r.seed(storedTeam({ id: "tm_a", org: "acme", slug: "a" }));
    await r.seed(storedTeam({ id: "tm_x", org: "other", slug: "x" }));
    await r.seed(storedTeam({ id: "tm_b", org: "acme", slug: "b" }));

    const listed = await r.queries.list({ org: "acme" });
    expect(listed.entries.map((team) => team.metadata?.id)).toEqual(["tm_b", "tm_a"]);
    expect(r.checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  /** Seeds `count` of acme's teams a minute apart; their ids, newest first. */
  async function seedTeams(r: ReturnType<typeof rig>, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `tm_${String(i).padStart(3, "0")}`;
      await r.seed(storedTeam({ id, org: "acme", slug: `team-${i}`, createdAt: new Date(Date.UTC(2026, 8, 24, 10, i)) }));
      ids.push(id);
    }
    return ids.reverse();
  }

  it("list answers a page and a token that continues it, newest first, to the end", async () => {
    const r = rig();
    const newestFirst = await seedTeams(r, 5);
    const read: string[] = [];
    const tokens: string[] = [];
    let pageToken = "";
    do {
      const page = await r.queries.list({ org: "acme", pageSize: 2, pageToken });
      read.push(...page.entries.map((team) => team.metadata?.id ?? ""));
      pageToken = page.nextPageToken;
      tokens.push(pageToken);
    } while (pageToken !== "");
    expect(read).toEqual(newestFirst);
    expect(tokens.map((token) => token !== "")).toEqual([true, true, false]);
  });

  it("list answers the default page of 50 and a token at size 0, never every team", async () => {
    const r = rig();
    const newestFirst = await seedTeams(r, 55);
    const first = await r.queries.list({ org: "acme", pageSize: 0, pageToken: "" });
    expect(first.entries.map((team) => team.metadata?.id)).toEqual(newestFirst.slice(0, 50));
    const rest = await r.queries.list({ org: "acme", pageSize: 0, pageToken: first.nextPageToken });
    expect(rest.entries.map((team) => team.metadata?.id)).toEqual(newestFirst.slice(50));
    expect(rest.nextPageToken).toBe("");
  });

  it("list walks only the teams carrying every label named, a page at a time", async () => {
    const r = rig();
    const labels = { group: "on-call", tier: "gold" };
    const plan: Record<string, string>[] = [{}, labels, { group: "on-call" }, { ...labels, extra: "x" }];
    for (const [i, teamLabels] of plan.entries()) {
      const team = storedTeam({ id: `tm_lbl_${i}`, org: "acme", slug: `labelled-${i}`, createdAt: new Date(Date.UTC(2026, 8, 24, 11, i)) });
      team.metadata!.labels = teamLabels;
      await r.seed(team);
    }
    const read: string[] = [];
    let pageToken = "";
    do {
      const page = await r.queries.list({ org: "acme", labels, pageSize: 1, pageToken });
      expect(page.entries.length).toBeLessThanOrEqual(1);
      read.push(...page.entries.map((row) => row.metadata?.id ?? ""));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    expect(read).toEqual(["tm_lbl_3", "tm_lbl_1"]);
  });

  it("list refuses a token issued for another organization's list", async () => {
    const r = rig();
    await seedTeams(r, 3);
    const { nextPageToken } = await r.queries.list({ org: "acme", pageSize: 1, pageToken: "" });
    const error = await failure(r.queries.list({ org: "globex", pageSize: 1, pageToken: nextPageToken }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("page_token was issued for a different request");
  });
});
