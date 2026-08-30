/**
 * Pins the ListReadScope shared consumption helper
 * (restrictListByReadScope — 20260830.01.sp.list-read-scoping), the ONE
 * idiom every post-scan list lane rides:
 *
 *   - no scope composed = the input unchanged, org NOT consulted (the
 *     byte-identity arm the four local conformance rosters also pin);
 *   - a composed scope narrows to the kept ids — and can only narrow:
 *     ids the scope answers that were never offered add nothing;
 *   - the org argument narrows AFTER the scope, only when non-blank
 *     (the Java repos' uniform blank-org posture);
 *   - the candidates carry {id, org, labels} — the driver's guest
 *     cookie rule keys on labels;
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

  it("a non-blank org narrows AFTER the scope; blank org does not", async () => {
    const scoped = scopeKeeping(["ses_a", "ses_c"]);
    const withOrg = await restrictListByReadScope(
      scoped,
      caller,
      ApiResourceKind.session,
      rows,
      "acme",
    );
    expect(withOrg.map((r) => r.metadata.id)).toEqual(["ses_a"]);
    const blankOrg = await restrictListByReadScope(
      scoped,
      caller,
      ApiResourceKind.session,
      rows,
      "",
    );
    expect(blankOrg.map((r) => r.metadata.id)).toEqual(["ses_a", "ses_c"]);
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
      { id: "ses_a", org: "acme", labels: { "stigmer.ai/guest-cookie-id": "ck_1" } },
      { id: "ses_b", org: "acme", labels: {} },
      { id: "ses_c", org: "rival", labels: {} },
    ]);
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
