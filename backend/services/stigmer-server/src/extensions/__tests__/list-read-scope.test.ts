/**
 * Pins the ListReadScope shared consumption helper
 * (restrictListByReadScope — 20260830.01.sp.list-read-scoping), the ONE
 * idiom every post-scan list lane rides:
 *
 *   - no scope composed = the input unchanged, org NOT consulted (the
 *     byte-identity arm the four local conformance rosters also pin);
 *   - a composed scope narrows to the kept ids — and can only narrow:
 *     ids the scope answers that were never offered add nothing;
 *   - the org argument narrows BEFORE the scope, only when non-blank
 *     (the Java repos' uniform blank-org posture; since stigmer-cloud
 *     20260913.04 T02 the scope is the last per-row predicate, so it is
 *     offered the org's rows and never the kind's — the same result set,
 *     a fraction of the candidates);
 *   - the `internal` class — the server acting as itself — gets the
 *     org-narrowed rows and the scope is never asked (the Authorize
 *     step's trust-domain rule on a list answer, stigmer#1207); the rule
 *     is class-only, so a caller PROPAGATED through the in-process
 *     transport (its own class, origin in-process) is still narrowed;
 *   - the candidates carry {id, org, labels} — the driver's guest
 *     cookie rule keys on labels — and the row's AUTHORIZATION FACTS
 *     (creator stamp, visibility level, every parent link), read by the
 *     one structural resolver the built-in authorizer reads a loaded row
 *     through, so a driver that evaluates the model over a candidate
 *     needs no second read of the row;
 *   - a kind whose authorization is its parent's (kind_meta PARENT scope
 *     + INHERITED owner; agent_execution → session) carries
 *     `authorizationParent` on every candidate whose spec names it, the
 *     same ResolvedParentLink the tuple lifecycle wrote and one of the
 *     candidate's own parent links; every other kind and every parentless
 *     row carries none (stigmer-cloud 20260913.04 T04);
 *   - a scope failure PROPAGATES — never an empty result (the outage
 *     contract: empty means "authorized to see nothing", outage means
 *     INTERNAL through the caller's sanitized arm).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { testCallerIdentity } from "../../pipeline/__tests__/support.js";
import type { ListEntryMeta, ListReadScope } from "../list-read-scope.js";
import { restrictListByReadScope } from "../list-read-scope.js";
import type { ResolvedParentLink } from "../resource-authorization.js";

const caller = testCallerIdentity();

function organizationLink(org: string): ResolvedParentLink {
  return {
    relation: "organization",
    parentKind: ApiResourceKind.organization,
    parentId: org,
  };
}

function sessionLink(session: string): ResolvedParentLink {
  return {
    relation: "session",
    parentKind: ApiResourceKind.session,
    parentId: session,
  };
}

/** The candidate a row with no audit and no visibility set becomes. */
function bareFacts(
  id: string,
  org: string,
  parentLinks: ReadonlyArray<ResolvedParentLink>,
): ListEntryMeta {
  return {
    id,
    org,
    labels: {},
    createdBy: "",
    visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
    parentLinks,
  };
}

function row(id: string, org: string, labels: Record<string, string> = {}) {
  return { metadata: { id, org, labels } };
}

const rows = [
  row("ses_a", "acme", { "stigmer.ai/guest-cookie-id": "ck_1" }),
  row("ses_b", "acme"),
  row("ses_c", "rival"),
];

function scopeKeeping(ids: ReadonlyArray<string>): ListReadScope {
  return {
    authorizedResourceIds: () => Promise.resolve(new Set(ids)),
    restrictListEntries: () => Promise.resolve(new Set(ids)),
  };
}

describe("restrictListByReadScope", () => {
  it("no scope composed = the input unchanged; org NOT consulted", async () => {
    const kept = await restrictListByReadScope(
      undefined,
      caller,
      ApiResourceKind.session,
      rows,
      "acme",
    );
    expect(kept).toEqual(rows);
  });

  it("a composed scope narrows to the kept ids", async () => {
    const kept = await restrictListByReadScope(
      scopeKeeping(["ses_a", "ses_c"]),
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(kept.map((r) => r.metadata.id)).toEqual(["ses_a", "ses_c"]);
  });

  it("the scope can only narrow — unoffered ids add nothing", async () => {
    const kept = await restrictListByReadScope(
      scopeKeeping(["ses_b", "ses_martian"]),
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(kept.map((r) => r.metadata.id)).toEqual(["ses_b"]);
  });

  it("a non-blank org narrows BEFORE the scope: the scope is offered the org's rows only; blank org offers them all", async () => {
    const offered: ReadonlyArray<ListEntryMeta>[] = [];
    const recording: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: (_caller, _kind, entries) => {
        offered.push(entries);
        return Promise.resolve(new Set(["ses_a", "ses_c"]));
      },
    };
    const withOrg = await restrictListByReadScope(
      recording,
      caller,
      ApiResourceKind.session,
      rows,
      "acme",
    );
    expect(withOrg.map((r) => r.metadata.id)).toEqual(["ses_a"]);
    // The rival's row was never a candidate: the engine is not asked
    // about rows the request's own predicate excludes.
    expect(offered[0]!.map((entry) => entry.id)).toEqual(["ses_a", "ses_b"]);
    const blankOrg = await restrictListByReadScope(
      recording,
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(blankOrg.map((r) => r.metadata.id)).toEqual(["ses_a", "ses_c"]);
    expect(offered[1]!.map((entry) => entry.id)).toEqual([
      "ses_a",
      "ses_b",
      "ses_c",
    ]);
  });

  describe("the internal class — the server acting as itself (stigmer#1207)", () => {
    /** A scope that must never be reached: any call is the failure under test. */
    const neverAsked: ListReadScope = {
      authorizedResourceIds: () =>
        Promise.reject(new Error("the scope was asked for the internal class")),
      restrictListEntries: () =>
        Promise.reject(new Error("the scope was asked for the internal class")),
    };
    const internal = testCallerIdentity({
      identityId: "system",
      callerClass: "internal",
      origin: "in-process",
    });

    it("gets the org-narrowed rows in the lane's order; the scope is never asked", async () => {
      const withOrg = await restrictListByReadScope(
        neverAsked,
        internal,
        ApiResourceKind.session,
        rows,
        "acme",
      );
      // The request's org predicate still applies — it is the request's,
      // not the caller's; only the caller predicate is skipped.
      expect(withOrg.map((r) => r.metadata.id)).toEqual(["ses_a", "ses_b"]);
      const blankOrg = await restrictListByReadScope(
        neverAsked,
        internal,
        ApiResourceKind.session,
        rows,
        "",
      );
      expect(blankOrg.map((r) => r.metadata.id)).toEqual([
        "ses_a",
        "ses_b",
        "ses_c",
      ]);
      // A fresh array either way, as every arm of the helper returns.
      expect(blankOrg).not.toBe(rows);
    });

    it("the rule is class-only: a caller propagated through the in-process transport keeps its class and is still narrowed", async () => {
      const propagated = testCallerIdentity({
        identityId: "alice",
        callerClass: "user",
        origin: "in-process",
      });
      const kept = await restrictListByReadScope(
        scopeKeeping(["ses_c"]),
        propagated,
        ApiResourceKind.session,
        rows,
        "",
      );
      expect(kept.map((r) => r.metadata.id)).toEqual(["ses_c"]);
    });
  });

  it("an empty kept set is a real answer — the empty list", async () => {
    const kept = await restrictListByReadScope(
      scopeKeeping([]),
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(kept).toEqual([]);
  });

  it("offers {id, org, labels} candidates and the call's kind to the scope", async () => {
    let seen: ReadonlyArray<ListEntryMeta> = [];
    let seenKind: ApiResourceKind | undefined;
    const recording: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: (_caller, kind, entries) => {
        seenKind = kind;
        seen = entries;
        return Promise.resolve(new Set<string>());
      },
    };
    await restrictListByReadScope(
      recording,
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(seenKind).toBe(ApiResourceKind.session);
    expect(seen).toEqual([
      {
        id: "ses_a",
        org: "acme",
        labels: { "stigmer.ai/guest-cookie-id": "ck_1" },
        createdBy: "",
        visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
        parentLinks: [organizationLink("acme")],
      },
      {
        id: "ses_b",
        org: "acme",
        labels: {},
        createdBy: "",
        visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
        parentLinks: [organizationLink("acme")],
      },
      {
        id: "ses_c",
        org: "rival",
        labels: {},
        createdBy: "",
        visibility: ApiResourceVisibility.api_resource_visibility_unspecified,
        parentLinks: [organizationLink("rival")],
      },
    ]);
  });

  it("a candidate carries the row's authorization facts — the creator stamp, the visibility level and every parent link — read by the one resolver the point-check driver reads through", async () => {
    let seen: ReadonlyArray<ListEntryMeta> = [];
    const recording: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: (_caller, _kind, entries) => {
        seen = entries;
        return Promise.resolve(new Set<string>());
      },
    };
    await restrictListByReadScope(
      recording,
      caller,
      ApiResourceKind.agent_instance,
      [
        {
          metadata: {
            id: "ai_1",
            org: "acme",
            labels: {},
            visibility: ApiResourceVisibility.visibility_org,
          },
          spec: { agentId: "agt_1" },
          status: {
            audit: create(ApiResourceAuditSchema, {
              specAudit: { createdBy: { id: "ida_carol" } },
            }),
          },
        },
      ],
      "",
    );
    expect(seen).toEqual([
      {
        id: "ai_1",
        org: "acme",
        labels: {},
        createdBy: "ida_carol",
        visibility: ApiResourceVisibility.visibility_org,
        parentLinks: [
          organizationLink("acme"),
          {
            relation: "agent",
            parentKind: ApiResourceKind.agent,
            parentId: "agt_1",
          },
        ],
      },
    ]);
  });

  describe("authorizationParent — the parent a kind's authorization is (20260913.04 T04)", () => {
    function recordingScope(keep: ReadonlyArray<string>) {
      const seen: ReadonlyArray<ListEntryMeta>[] = [];
      const scope: ListReadScope = {
        authorizedResourceIds: () => Promise.resolve(new Set<string>()),
        restrictListEntries: (_caller, _kind, entries) => {
          seen.push(entries);
          return Promise.resolve(new Set(keep));
        },
      };
      return { scope, seen };
    }

    it("an agent_execution candidate carries its session as the ResolvedParentLink the tuple lifecycle wrote", async () => {
      const executions = [
        {
          metadata: { id: "aex_1", org: "acme", labels: {} },
          spec: { sessionId: "ses_a" },
        },
        {
          metadata: { id: "aex_2", org: "acme", labels: {} },
          spec: { sessionId: "ses_a" },
        },
        {
          metadata: { id: "aex_3", org: "acme", labels: {} },
          spec: { sessionId: "ses_b" },
        },
      ];
      const { scope, seen } = recordingScope(["aex_1", "aex_3"]);
      const kept = await restrictListByReadScope(
        scope,
        caller,
        ApiResourceKind.agent_execution,
        executions,
        "",
      );
      expect(kept.map((r) => r.metadata.id)).toEqual(["aex_1", "aex_3"]);
      // The parent is one of the row's parent links — resolved once, named
      // twice: as the link the derivation reads and as the designation a
      // driver may answer in place of the child.
      expect(seen[0]).toEqual([
        {
          ...bareFacts("aex_1", "acme", [sessionLink("ses_a")]),
          authorizationParent: sessionLink("ses_a"),
        },
        {
          ...bareFacts("aex_2", "acme", [sessionLink("ses_a")]),
          authorizationParent: sessionLink("ses_a"),
        },
        {
          ...bareFacts("aex_3", "acme", [sessionLink("ses_b")]),
          authorizationParent: sessionLink("ses_b"),
        },
      ]);
    });

    it("a row whose spec does not name its parent carries no parent — offered as itself, never dropped", async () => {
      const executions = [
        { metadata: { id: "aex_orphan", org: "acme", labels: {} }, spec: {} },
        { metadata: { id: "aex_specless", org: "acme", labels: {} } },
      ];
      const { scope, seen } = recordingScope(["aex_orphan", "aex_specless"]);
      const kept = await restrictListByReadScope(
        scope,
        caller,
        ApiResourceKind.agent_execution,
        executions,
        "",
      );
      expect(kept.map((r) => r.metadata.id)).toEqual([
        "aex_orphan",
        "aex_specless",
      ]);
      expect(seen[0]).toEqual([
        bareFacts("aex_orphan", "acme", []),
        bareFacts("aex_specless", "acme", []),
      ]);
    });

    it("a kind whose authorization is its own carries no parent even when its spec names one", async () => {
      // A workflow_execution links its workflow_instance (an additional
      // parent, partial opt-in inheritance) and owns itself: not the pair.
      const runs = [
        {
          metadata: { id: "wex_1", org: "acme", labels: {} },
          spec: { workflowInstanceId: "wfi_1" },
        },
      ];
      const { scope, seen } = recordingScope(["wex_1"]);
      await restrictListByReadScope(
        scope,
        caller,
        ApiResourceKind.workflow_execution,
        runs,
        "",
      );
      // The instance IS a parent link (the derivation walks
      // `execution_viewer from workflow_instance` through it); it is not
      // the parent the kind's authorization is.
      expect(seen[0]).toEqual([
        bareFacts("wex_1", "acme", [
          organizationLink("acme"),
          {
            relation: "workflow_instance",
            parentKind: ApiResourceKind.workflow_instance,
            parentId: "wfi_1",
          },
        ]),
      ]);
    });

    it("no scope composed = the input unchanged, the parent never resolved", async () => {
      const executions = [
        {
          metadata: { id: "aex_1", org: "acme", labels: {} },
          spec: { sessionId: "ses_a" },
        },
      ];
      const kept = await restrictListByReadScope(
        undefined,
        caller,
        ApiResourceKind.agent_execution,
        executions,
        "acme",
      );
      expect(kept).toEqual(executions);
    });
  });

  it("a scope failure propagates — never an empty result", async () => {
    const failing: ListReadScope = {
      authorizedResourceIds: () => Promise.reject(new Error("fga down")),
      restrictListEntries: () => Promise.reject(new Error("fga down")),
    };
    await expect(
      restrictListByReadScope(
        failing,
        caller,
        ApiResourceKind.session,
        rows,
        "",
      ),
    ).rejects.toThrow("fga down");
  });
});
