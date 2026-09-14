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
 *   - the candidates carry {id, org, labels} — the driver's guest
 *     cookie rule keys on labels;
 *   - a kind whose authorization is its parent's (kind_meta PARENT scope
 *     + INHERITED owner; agent_execution → session) carries
 *     `authorizationParent` on every candidate whose spec names it, the
 *     same ResolvedParentLink the tuple lifecycle wrote; every other kind
 *     and every parentless row carries none (stigmer-cloud 20260913.04
 *     T04);
 *   - a scope failure PROPAGATES — never an empty result (the outage
 *     contract: empty means "authorized to see nothing", outage means
 *     INTERNAL through the caller's sanitized arm).
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../pipeline/__tests__/support.js";
import type { ListEntryMeta, ListReadScope } from "../list-read-scope.js";
import { restrictListByReadScope } from "../list-read-scope.js";

const caller = testCallerIdentity();

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
      },
      { id: "ses_b", org: "acme", labels: {} },
      { id: "ses_c", org: "rival", labels: {} },
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
      expect(seen[0]).toEqual([
        {
          id: "aex_1",
          org: "acme",
          labels: {},
          authorizationParent: {
            relation: "session",
            parentKind: ApiResourceKind.session,
            parentId: "ses_a",
          },
        },
        {
          id: "aex_2",
          org: "acme",
          labels: {},
          authorizationParent: {
            relation: "session",
            parentKind: ApiResourceKind.session,
            parentId: "ses_a",
          },
        },
        {
          id: "aex_3",
          org: "acme",
          labels: {},
          authorizationParent: {
            relation: "session",
            parentKind: ApiResourceKind.session,
            parentId: "ses_b",
          },
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
        { id: "aex_orphan", org: "acme", labels: {} },
        { id: "aex_specless", org: "acme", labels: {} },
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
      expect(seen[0]).toEqual([{ id: "wex_1", org: "acme", labels: {} }]);
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
