/**
 * The credential binding (../credential-binding.ts): the rule's table and
 * the three decorators the composition root wraps its drivers with.
 *
 * What it pins:
 *   - an unbound caller is never read for and gets the inner answer byte
 *     for byte, on every decorator;
 *   - every scope class: the organization itself (by id), an
 *     organization-scoped row and a parent-scoped execution (by the row's
 *     organization), an execution context (owner-only, decided by its
 *     row's organization), an owner-only kind and an unscoped one (inside);
 *   - a missing row reaches the inner driver, so not-found stays not-found;
 *   - the one admitted path and its limits: a blueprint at platform
 *     visibility for a read or run permission, a default instance of such
 *     a blueprint, and refusals for an org-visible blueprint, an edit
 *     permission and a non-default instance;
 *   - a kind the model gives no schema is outside;
 *   - a target's row is read once per caller object, and a failed read is
 *     retried; a read fault answers `unavailable`, never a denial;
 *   - the rows of the two substitutable ports and a unit's reader are read
 *     there, never from the store;
 *   - the list scope drops candidates by their facts, the enumeration
 *     narrows by each id's row, and the directory answers the bound
 *     organization alone.
 */
import type { Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../extensions/list-read-scope.js";
import type { OrganizationDirectory } from "../../extensions/organization-directory.js";
import { ALL_ORGANIZATIONS } from "../../extensions/organization-directory.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  BOUND_ELSEWHERE_DENY_REASON,
  bindAuthorizer,
  bindListReadScope,
  bindOrganizationDirectory,
  newCredentialBinding,
} from "../credential-binding.js";
import type { CredentialBindingDeps } from "../credential-binding.js";
import { fixtureRow, storedDeclaration } from "./support.js";

const ALPHA = "org_alpha";
const BETA = "org_beta";

const unbound: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "",
  rawToken: "stk_x",
};

function boundTo(org: string): CallerIdentity {
  return { ...unbound, boundOrg: org };
}

function row(
  type: string,
  id: string,
  org: string,
  extra: {
    visibility?: ApiResourceVisibility;
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
  } = {},
): { kind: ApiResourceKind; id: string; row: Message } {
  const declaration = storedDeclaration(type);
  return {
    kind: declaration.kind,
    id,
    row: fixtureRow(declaration, {
      id,
      org,
      visibility: extra.visibility ?? ApiResourceVisibility.visibility_org,
      createdBy: "ida_bob",
      ...(extra.spec === undefined ? {} : { spec: extra.spec }),
      ...(extra.status === undefined ? {} : { status: extra.status }),
    }),
  };
}

interface Fixture {
  readonly deps: CredentialBindingDeps;
  /** Every store read, as `kind:id`. */
  readonly reads: string[];
  failNext(): void;
}

function fixture(
  rows: ReadonlyArray<{ kind: ApiResourceKind; id: string; row: Message }>,
  ports: {
    policies?: ReadonlyArray<IamPolicy>;
    clients?: ReadonlyArray<PlatformClient>;
    readers?: ReadonlyMap<
      ApiResourceKind,
      { findById(id: string): Promise<Message | undefined> }
    >;
  } = {},
): Fixture {
  const byKey = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r.row]));
  const reads: string[] = [];
  let fail = false;
  const getResource = (kind: ApiResourceKind, id: string): Promise<Message> => {
    reads.push(`${kind}:${id}`);
    if (fail) {
      fail = false;
      return Promise.reject(new Error("store unavailable"));
    }
    const found = byKey.get(`${kind}:${id}`);
    return found === undefined
      ? Promise.reject(new ResourceNotFoundError(`${kind}:${id}`))
      : Promise.resolve(found);
  };
  // The fixture rows were built with each kind's own schema, so the
  // generic signature's decode is already done; the cast only drops it.
  const store = { getResource } as unknown as Pick<Store, "getResource">;
  return {
    reads,
    failNext: () => {
      fail = true;
    },
    deps: {
      store,
      policies: {
        findById: (id) =>
          Promise.resolve(ports.policies?.find((p) => p.metadata?.id === id)),
      },
      platformClients: {
        findById: (id) =>
          Promise.resolve(ports.clients?.find((c) => c.metadata?.id === id)),
      },
      ...(ports.readers === undefined ? {} : { rowReaders: ports.readers }),
    },
  };
}

const VIEW = IamPermission[IamPermission.can_view];
const EDIT = IamPermission[IamPermission.can_edit];
const EXECUTE = IamPermission[IamPermission.can_execute];

describe("the rule, for a caller bound to one organization", () => {
  it("answers unbound for a caller that names no organization, and reads nothing", async () => {
    const f = fixture([row("agent", "agt_b", BETA)]);
    const binding = newCredentialBinding(f.deps);
    expect(
      await binding.verdict(unbound, {
        kind: ApiResourceKind.agent,
        id: "agt_b",
        permission: EDIT,
      }),
    ).toBe("unbound");
    expect(
      await binding.verdict(
        { ...unbound, boundOrg: "" },
        { kind: ApiResourceKind.agent, id: "agt_b", permission: EDIT },
      ),
    ).toBe("unbound");
    expect(f.reads).toEqual([]);
  });

  it("decides the organization itself by its id, with no read", async () => {
    const f = fixture([]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.organization,
        id: ALPHA,
        permission: EDIT,
      }),
    ).toBe("inside");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.organization,
        id: BETA,
        permission: VIEW,
      }),
    ).toBe("outside");
    expect(f.reads).toEqual([]);
  });

  it("decides an organization-scoped row and a parent-scoped execution by the row's organization", async () => {
    const f = fixture([
      row("session", "ses_a", ALPHA),
      row("session", "ses_b", BETA),
      row("agent_execution", "aex_a", ALPHA),
      row("agent_execution", "aex_b", BETA),
    ]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    const verdictOf = (kind: ApiResourceKind, id: string) =>
      binding.verdict(caller, { kind, id, permission: VIEW });
    expect(await verdictOf(ApiResourceKind.session, "ses_a")).toBe("inside");
    expect(await verdictOf(ApiResourceKind.session, "ses_b")).toBe("outside");
    expect(await verdictOf(ApiResourceKind.agent_execution, "aex_a")).toBe(
      "inside",
    );
    expect(await verdictOf(ApiResourceKind.agent_execution, "aex_b")).toBe(
      "outside",
    );
  });

  it("passes owner-only and unscoped kinds, which belong to no organization, with no read", async () => {
    const f = fixture([]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    for (const kind of [
      ApiResourceKind.identity_account,
      ApiResourceKind.platform,
      ApiResourceKind.plan,
    ]) {
      expect(
        await binding.verdict(caller, { kind, id: "x", permission: EDIT }),
      ).toBe("inside");
    }
    expect(f.reads).toEqual([]);
  });

  it("decides an execution context, owner-only but its run's, by the row's organization", async () => {
    const f = fixture([
      row("execution_context", "ectx_a", ALPHA),
      row("execution_context", "ectx_b", BETA),
    ]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    const verdictOf = (id: string) =>
      binding.verdict(caller, {
        kind: ApiResourceKind.execution_context,
        id,
        permission: VIEW,
      });
    expect(await verdictOf("ectx_a")).toBe("inside");
    expect(await verdictOf("ectx_b")).toBe("outside");
    expect(
      binding.keepsEntry(
        caller,
        ApiResourceKind.execution_context,
        entry("ectx_b", BETA),
      ),
    ).toBe(false);
  });

  it("decides an API key by the organization it is limited to: a bound credential manages only the keys limited where it is", async () => {
    const f = fixture([
      row("api_key", "key_a", "", { spec: { boundOrg: ALPHA } }),
      row("api_key", "key_b", "", { spec: { boundOrg: BETA } }),
      row("api_key", "key_everywhere", ""),
    ]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    const verdictOf = (id: string) =>
      binding.verdict(caller, {
        kind: ApiResourceKind.api_key,
        id,
        permission: EDIT,
      });
    expect(await verdictOf("key_a")).toBe("inside");
    expect(await verdictOf("key_b")).toBe("outside");
    expect(await verdictOf("key_everywhere")).toBe("outside");
    expect(await verdictOf("key_missing")).toBe("missing");
  });

  it("answers missing for an id no row has, so the inner driver keeps its not-found", async () => {
    const binding = newCredentialBinding(fixture([]).deps);
    expect(
      await binding.verdict(boundTo(ALPHA), {
        kind: ApiResourceKind.agent,
        id: "agt_gone",
        permission: VIEW,
      }),
    ).toBe("missing");
  });

  it("refuses a kind the model gives no schema, which no check can allow", async () => {
    const binding = newCredentialBinding(fixture([]).deps);
    expect(
      await binding.verdict(boundTo(ALPHA), {
        kind: ApiResourceKind.subscription,
        id: "sub_1",
        permission: VIEW,
      }),
    ).toBe("outside");
  });

  it("admits a blueprint shared at platform visibility for reading and running only", async () => {
    const f = fixture([
      row("agent", "agt_shared", BETA, {
        visibility: ApiResourceVisibility.visibility_platform,
      }),
      row("skill", "skl_org", BETA),
    ]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.agent,
        id: "agt_shared",
        permission: VIEW,
      }),
    ).toBe("admitted");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.agent,
        id: "agt_shared",
        permission: EXECUTE,
      }),
    ).toBe("admitted");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.agent,
        id: "agt_shared",
        permission: EDIT,
      }),
    ).toBe("outside");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.skill,
        id: "skl_org",
        permission: VIEW,
      }),
    ).toBe("outside");
  });

  it("admits connecting to an MCP server shared at platform visibility, never editing it", async () => {
    const f = fixture([
      row("mcp_server", "mcps_shared", BETA, {
        visibility: ApiResourceVisibility.visibility_platform,
      }),
    ]);
    const binding = newCredentialBinding(f.deps);
    const verdictOf = (permission: string) =>
      binding.verdict(boundTo(ALPHA), {
        kind: ApiResourceKind.mcp_server,
        id: "mcps_shared",
        permission,
      });
    expect(await verdictOf(IamPermission[IamPermission.can_connect])).toBe(
      "admitted",
    );
    expect(await verdictOf(EDIT)).toBe("outside");
  });

  it("admits the default instance of a shared blueprint, and no other instance", async () => {
    const f = fixture([
      row("workflow", "wfl_shared", BETA, {
        visibility: ApiResourceVisibility.visibility_platform,
        status: { defaultInstanceId: "wfi_default" },
      }),
      row("workflow_instance", "wfi_default", BETA, {
        spec: { workflowId: "wfl_shared" },
      }),
      row("workflow_instance", "wfi_personal", BETA, {
        spec: { workflowId: "wfl_shared" },
      }),
    ]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.workflow_instance,
        id: "wfi_default",
        permission: EXECUTE,
      }),
    ).toBe("admitted");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.workflow_instance,
        id: "wfi_personal",
        permission: VIEW,
      }),
    ).toBe("outside");
  });

  it("refuses an instance that names no blueprint, or whose blueprint is gone", async () => {
    const f = fixture([
      row("workflow_instance", "wfi_orphan", BETA, {
        spec: { workflowId: "" },
      }),
      row("workflow_instance", "wfi_gone", BETA, {
        spec: { workflowId: "wfl_gone" },
      }),
    ]);
    const binding = newCredentialBinding(f.deps);
    for (const id of ["wfi_orphan", "wfi_gone"]) {
      expect(
        await binding.verdict(boundTo(ALPHA), {
          kind: ApiResourceKind.workflow_instance,
          id,
          permission: VIEW,
        }),
      ).toBe("outside");
    }
  });

  it("keeps list candidates by their facts: every one for an unbound caller, the organization by id, and kinds no organization owns", () => {
    const binding = newCredentialBinding(fixture([]).deps);
    const candidate = entry("x", BETA);
    expect(binding.keepsEntry(unbound, ApiResourceKind.agent, candidate)).toBe(
      true,
    );
    expect(
      binding.keepsEntry(
        boundTo(ALPHA),
        ApiResourceKind.organization,
        entry(ALPHA, ""),
      ),
    ).toBe(true);
    expect(
      binding.keepsEntry(
        boundTo(ALPHA),
        ApiResourceKind.organization,
        entry(BETA, ""),
      ),
    ).toBe(false);
    expect(
      binding.keepsEntry(boundTo(ALPHA), ApiResourceKind.api_key, candidate),
    ).toBe(true);
    expect(
      binding.keepsEntry(boundTo(ALPHA), ApiResourceKind.agent, candidate),
    ).toBe(false);
  });

  it("reads a target once per caller object, and asks again after a failed read", async () => {
    const f = fixture([row("session", "ses_a", ALPHA)]);
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    const target = {
      kind: ApiResourceKind.session,
      id: "ses_a",
      permission: VIEW,
    };
    f.failNext();
    await expect(binding.verdict(caller, target)).rejects.toThrow(
      "store unavailable",
    );
    expect(await binding.verdict(caller, target)).toBe("inside");
    expect(await binding.verdict(caller, target)).toBe("inside");
    expect(f.reads).toHaveLength(2);
    await binding.verdict(boundTo(ALPHA), target);
    expect(f.reads).toHaveLength(3);
  });

  it("reads the two substitutable ports and a unit's reader, never the store, for their kinds", async () => {
    const team = row("team", "tm_b", BETA);
    const f = fixture([], {
      policies: [
        create(IamPolicySchema, { metadata: { id: "pol_a", org: ALPHA } }),
      ],
      clients: [
        create(PlatformClientSchema, { metadata: { id: "pcl_b", org: BETA } }),
      ],
      readers: new Map([
        [
          ApiResourceKind.team,
          {
            findById: (id: string) =>
              Promise.resolve(id === "tm_b" ? team.row : undefined),
          },
        ],
      ]),
    });
    const binding = newCredentialBinding(f.deps);
    const caller = boundTo(ALPHA);
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.iam_policy,
        id: "pol_a",
        permission: EDIT,
      }),
    ).toBe("inside");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.platform_client,
        id: "pcl_b",
        permission: VIEW,
      }),
    ).toBe("outside");
    expect(
      await binding.verdict(caller, {
        kind: ApiResourceKind.team,
        id: "tm_b",
        permission: VIEW,
      }),
    ).toBe("outside");
    expect(f.reads).toEqual([]);
  });
});

function recordingAuthorizer(): Authorizer & { checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorize(_caller, check) {
      checks.push(check);
      return Promise.resolve({ kind: "allow" });
    },
  };
}

describe("bindAuthorizer", () => {
  const f = fixture([
    row("session", "ses_a", ALPHA),
    row("session", "ses_b", BETA),
  ]);
  const check = (id: string): AuthzCheck => ({
    permission: IamPermission.can_view,
    resourceKind: ApiResourceKind.session,
    resourceId: id,
  });

  it("hands an unbound caller to the inner driver with no read", async () => {
    const inner = recordingAuthorizer();
    const bound = bindAuthorizer(inner, newCredentialBinding(f.deps));
    const before = f.reads.length;
    expect(await bound.authorize(unbound, check("ses_b"))).toEqual({
      kind: "allow",
    });
    expect(inner.checks).toHaveLength(1);
    expect(f.reads).toHaveLength(before);
  });

  it("denies a bound caller outside its organization before the inner driver is asked", async () => {
    const inner = recordingAuthorizer();
    const bound = bindAuthorizer(inner, newCredentialBinding(f.deps));
    expect(await bound.authorize(boundTo(ALPHA), check("ses_b"))).toEqual({
      kind: "deny",
      reason: BOUND_ELSEWHERE_DENY_REASON,
    });
    expect(inner.checks).toEqual([]);
    expect(await bound.authorize(boundTo(ALPHA), check("ses_a"))).toEqual({
      kind: "allow",
    });
    expect(inner.checks).toHaveLength(1);
  });

  it("hands a missing target to the inner driver", async () => {
    const inner: Authorizer = {
      authorize: () => Promise.resolve({ kind: "not-found" }),
    };
    const bound = bindAuthorizer(inner, newCredentialBinding(f.deps));
    expect(await bound.authorize(boundTo(ALPHA), check("ses_gone"))).toEqual({
      kind: "not-found",
    });
  });

  it("answers unavailable when the target's row cannot be read", async () => {
    const failing = fixture([row("session", "ses_a", ALPHA)]);
    const bound = bindAuthorizer(
      recordingAuthorizer(),
      newCredentialBinding(failing.deps),
    );
    failing.failNext();
    const decision = await bound.authorize(boundTo(ALPHA), check("ses_a"));
    expect(decision.kind).toBe("unavailable");
  });
});

function entry(
  id: string,
  org: string,
  visibility = ApiResourceVisibility.visibility_org,
): ListEntryMeta {
  return { id, org, visibility, createdBy: "", parentLinks: [], labels: {} };
}

describe("bindListReadScope", () => {
  function recordingScope(): ListReadScope & {
    offered: string[][];
  } {
    const offered: string[][] = [];
    return {
      offered,
      authorizedResourceIds: () =>
        Promise.resolve(new Set(["agt_a", "agt_b", "agt_shared"])),
      restrictListEntries(_caller, _kind, entries) {
        offered.push(entries.map((e) => e.id));
        return Promise.resolve(new Set(entries.map((e) => e.id)));
      },
    };
  }
  const f = fixture([
    row("agent", "agt_a", ALPHA),
    row("agent", "agt_b", BETA),
    row("agent", "agt_shared", BETA, {
      visibility: ApiResourceVisibility.visibility_platform,
    }),
  ]);

  it("offers an unbound caller's candidates whole", async () => {
    const inner = recordingScope();
    const scope = bindListReadScope(inner, newCredentialBinding(f.deps));
    await scope.restrictListEntries(unbound, ApiResourceKind.agent, [
      entry("agt_a", ALPHA),
      entry("agt_b", BETA),
    ]);
    expect(inner.offered).toEqual([["agt_a", "agt_b"]]);
  });

  it("drops a bound caller's candidates outside its organization, keeping shared blueprints for the inner scope", async () => {
    const inner = recordingScope();
    const scope = bindListReadScope(inner, newCredentialBinding(f.deps));
    const before = f.reads.length;
    const kept = await scope.restrictListEntries(
      boundTo(ALPHA),
      ApiResourceKind.agent,
      [
        entry("agt_a", ALPHA),
        entry("agt_b", BETA),
        entry("agt_shared", BETA, ApiResourceVisibility.visibility_platform),
      ],
    );
    expect([...kept]).toEqual(["agt_a", "agt_shared"]);
    expect(f.reads).toHaveLength(before);
  });

  it("narrows an enumeration larger than one read batch, keeping every id inside", async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row("session", `ses_${i}`, i % 2 === 0 ? ALPHA : BETA),
    );
    const binding = newCredentialBinding(fixture(rows).deps);
    const kept = await binding.narrowIds(
      boundTo(ALPHA),
      ApiResourceKind.session,
      new Set(rows.map((r) => r.id)),
      VIEW,
    );
    expect([...kept].sort()).toEqual(
      rows
        .filter((_, i) => i % 2 === 0)
        .map((r) => r.id)
        .sort(),
    );
  });

  it("narrows the enumeration by each id's row", async () => {
    const scope = bindListReadScope(
      recordingScope(),
      newCredentialBinding(f.deps),
    );
    expect([
      ...(await scope.authorizedResourceIds(
        boundTo(ALPHA),
        ApiResourceKind.agent,
      )),
    ]).toEqual(["agt_a", "agt_shared"]);
    expect(
      (await scope.authorizedResourceIds(unbound, ApiResourceKind.agent)).size,
    ).toBe(3);
  });
});

describe("bindOrganizationDirectory", () => {
  function directory(
    ids: ReadonlyArray<string> | typeof ALL_ORGANIZATIONS,
  ): OrganizationDirectory {
    return {
      refusesEnumeration: true,
      listMyOrganizationIds: () => Promise.resolve(ids),
    };
  }

  it("answers an unbound caller with the inner list", async () => {
    const bound = bindOrganizationDirectory(directory([ALPHA, BETA]));
    expect(await bound.listMyOrganizationIds(unbound)).toEqual([ALPHA, BETA]);
    expect(bound.refusesEnumeration).toBe(true);
    expect(bound.lookupExternalOrganization).toBeUndefined();
  });

  it("answers a bound caller with its own organization alone, when the inner directory holds it", async () => {
    expect(
      await bindOrganizationDirectory(
        directory([ALPHA, BETA]),
      ).listMyOrganizationIds(boundTo(ALPHA)),
    ).toEqual([ALPHA]);
    expect(
      await bindOrganizationDirectory(directory([BETA])).listMyOrganizationIds(
        boundTo(ALPHA),
      ),
    ).toEqual([]);
    expect(
      await bindOrganizationDirectory(
        directory(ALL_ORGANIZATIONS),
      ).listMyOrganizationIds(boundTo(ALPHA)),
    ).toEqual([ALPHA]);
  });
});
