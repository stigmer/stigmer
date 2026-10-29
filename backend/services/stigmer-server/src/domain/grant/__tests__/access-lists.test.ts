/**
 * Pins access-lists.ts: the row-driven answer to
 * "who has access, with which roles" — the hierarchy walk over scope
 * tuples (child → parent through the resource's one structural link, at
 * most five steps, `platform` terminal) and the grouping of assignable-
 * role rows by principal in first-seen order, enriched where the display
 * resolver answers and rendered as kind/id with the id as its name
 * everywhere else (the fallback shape). A grantee that is not a person (a team)
 * is named by the composed principal display, one call per kind, keyed by
 * kind and id so one kind's view never names another kind's id. A
 * resource's list names only the people inside its organization's bound:
 * a role row on the organization, or, on a child organization, an admin or
 * owner row on its parent, so a parent's admin who made a row in a child
 * is listed while they are one and left out once they are not.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { ApiResourceRefViewSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";

import type { PrincipalDisplay } from "../../../extensions/principal-display.js";
import { buildPrincipalAccessList, resolveHierarchy } from "../access-lists.js";
import type { PrincipalDisplayResolver } from "../access-lists.js";
import { grantIdFor } from "../constants.js";
import { fakeGrantStore, organizationRows, orgRole, triple } from "./support.js";

/** No organization has a row: every resource's organization reads as a top-level one. */
const NO_ORGANIZATIONS = organizationRows({});

function row(spec: GrantSpec) {
  return create(GrantSchema, {
    metadata: { id: grantIdFor(spec) },
    spec,
  });
}

/** `child` is scoped under `parent`: the structural link the walk follows. */
function scopeLink(
  child: { kind: string; id: string },
  parent: { kind: string; id: string },
): GrantSpec {
  return triple(parent, parent.kind, child);
}

const nobody: PrincipalDisplayResolver = {
  resolveIdentityAccounts: () => Promise.resolve(new Map()),
};

describe("resolveHierarchy", () => {
  it("is the resource alone when inherited grants are not asked for", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a1" },
          { kind: "organization", id: "acme" },
        ),
      ),
    );
    expect(await resolveHierarchy(store, "agent", "a1", false)).toEqual([
      { kind: "agent", id: "a1" },
    ]);
  });

  it("climbs the scope links child-first and stops where no link exists", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a1" },
          { kind: "organization", id: "acme" },
        ),
      ),
    );
    expect(await resolveHierarchy(store, "agent", "a1", true)).toEqual([
      { kind: "agent", id: "a1" },
      { kind: "organization", id: "acme" },
    ]);
  });

  it("stops at platform, the terminal kind, even when platform carries a link", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "organization", id: "acme" },
          { kind: "platform", id: "stigmer" },
        ),
      ),
    );
    await store.save(
      row(
        scopeLink(
          { kind: "platform", id: "stigmer" },
          { kind: "organization", id: "loop" },
        ),
      ),
    );
    expect(await resolveHierarchy(store, "organization", "acme", true)).toEqual(
      [
        { kind: "organization", id: "acme" },
        { kind: "platform", id: "stigmer" },
      ],
    );
  });

  it("walks at most five steps — a cycle cannot spin it", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(scopeLink({ kind: "agent", id: "a" }, { kind: "agent", id: "b" })),
    );
    await store.save(
      row(scopeLink({ kind: "agent", id: "b" }, { kind: "agent", id: "a" })),
    );
    const levels = await resolveHierarchy(store, "agent", "a", true);
    expect(levels).toHaveLength(6);
  });

  it("ignores rows whose principal is a person or whose relation is owner/creator — those are grants, not links", async () => {
    const store = fakeGrantStore();
    await store.save(row(orgRole("ida_alice", "owner", "acme")));
    await store.save(
      row(
        triple({ kind: "organization", id: "parent" }, "owner", {
          kind: "organization",
          id: "acme",
        }),
      ),
    );
    expect(await resolveHierarchy(store, "organization", "acme", true)).toEqual(
      [{ kind: "organization", id: "acme" }],
    );
  });
});

describe("buildPrincipalAccessList", () => {
  it("answers nothing for a resource with no assignable-role rows — structural rows never show", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a1" },
          { kind: "organization", id: "acme" },
        ),
      ),
    );
    expect(
      await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
        { kind: "agent", id: "a1" },
      ]),
    ).toEqual([]);
  });

  it("groups by principal in first-seen order, one RoleGrant per row, direct grants without an owner resource", async () => {
    const store = fakeGrantStore();
    await store.save(row(orgRole("ida_bob", "member", "acme")));
    await store.save(row(orgRole("ida_alice", "owner", "acme")));
    await store.save(row(orgRole("ida_bob", "viewer", "acme")));
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "organization", id: "acme" },
    ]);
    expect(entries.map((e) => e.principal?.id)).toEqual([
      "ida_bob",
      "ida_alice",
    ]);
    const bob = entries[0];
    expect(bob?.roles.map((g) => g.role?.code)).toEqual(["member", "viewer"]);
    expect(
      bob?.roles.every((g) => !g.isInherited && g.ownerResource === undefined),
    ).toBe(true);
  });

  it("marks grants from a parent level as inherited and names the owning level", async () => {
    const store = fakeGrantStore();
    await store.save(row(orgRole("ida_alice", "admin", "acme")));
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "agent", id: "a1" },
      { kind: "organization", id: "acme" },
    ]);
    expect(entries).toHaveLength(1);
    const grant = entries[0]?.roles[0];
    expect(grant?.isInherited).toBe(true);
    expect(grant?.ownerResource?.kind).toBe("organization");
    expect(grant?.ownerResource?.id).toBe("acme");
    expect(grant?.role?.code).toBe("admin");
  });

  it("renders an unresolved principal of ANY kind as kind/id with the id as its name", async () => {
    const store = fakeGrantStore();
    await store.save(row(orgRole("ida_ghost", "viewer", "acme")));
    await store.save(
      row(
        triple({ kind: "team", id: "tm_1" }, "viewer", {
          kind: "organization",
          id: "acme",
        }),
      ),
    );
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "organization", id: "acme" },
    ]);
    expect(
      entries.map((e) => [
        e.principal?.kind,
        e.principal?.id,
        e.principal?.name,
      ]),
    ).toEqual([
      ["identity_account", "ida_ghost", "ida_ghost"],
      ["team", "tm_1", "tm_1"],
    ]);
  });

  it("asks the resolver once for the identity-account ids and uses its view where it answers", async () => {
    const store = fakeGrantStore();
    await store.save(row(orgRole("ida_alice", "owner", "acme")));
    await store.save(row(orgRole("ida_bob", "member", "acme")));
    const asked: string[][] = [];
    const resolver: PrincipalDisplayResolver = {
      resolveIdentityAccounts: (ids) => {
        asked.push([...ids]);
        return Promise.resolve(
          new Map([
            [
              "ida_alice",
              create(ApiResourceRefViewSchema, {
                kind: "identity_account",
                id: "ida_alice",
                name: "Alice",
                email: "alice@example.com",
              }),
            ],
          ]),
        );
      },
    };
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, resolver, undefined, [
      { kind: "organization", id: "acme" },
    ]);
    expect(asked).toEqual([["ida_alice", "ida_bob"]]);
    expect(entries.map((e) => e.principal?.name)).toEqual(["Alice", "ida_bob"]);
    expect(entries[0]?.principal?.email).toBe("alice@example.com");
  });

  it("names a team grantee through the composed principal display, once per kind, and never lends one kind's view to another kind's id", async () => {
    const store = fakeGrantStore();
    // A person and a team that share an id string: the views must not cross.
    await store.save(row(orgRole("shared_1", "viewer", "acme")));
    await store.save(
      row(
        triple({ kind: "team", id: "shared_1", relation: "member" }, "viewer", {
          kind: "organization",
          id: "acme",
        }),
      ),
    );
    await store.save(
      row(
        triple({ kind: "team", id: "tm_gone", relation: "member" }, "viewer", {
          kind: "organization",
          id: "acme",
        }),
      ),
    );
    const asked: Array<[ApiResourceKind, string[]]> = [];
    const teams: PrincipalDisplay = {
      resolve: (kind, ids) => {
        asked.push([kind, [...ids]]);
        return Promise.resolve(
          new Map([
            [
              "shared_1",
              create(ApiResourceRefViewSchema, {
                kind: "team",
                id: "shared_1",
                name: "Site Reliability",
              }),
            ],
          ]),
        );
      },
    };
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, teams, [
      { kind: "organization", id: "acme" },
    ]);
    expect(asked).toEqual([[ApiResourceKind.team, ["shared_1", "tm_gone"]]]);
    expect(entries.map((e) => [e.principal?.kind, e.principal?.name])).toEqual([
      ["identity_account", "shared_1"],
      ["team", "Site Reliability"],
      // A team the display does not know (deleted since) keeps the fallback.
      ["team", "tm_gone"],
    ]);
  });

  it("names every grantee with the relation qualifier its rows hold, and never merges two qualifiers of one grantee", async () => {
    const store = fakeGrantStore();
    const agent = { kind: "agent", id: "agt_1" };
    await store.save(
      row(
        triple({ kind: "identity_account", id: "ida_alice" }, "viewer", agent),
      ),
    );
    await store.save(
      row(
        triple(
          { kind: "team", id: "tm_sre", relation: "member" },
          "viewer",
          agent,
        ),
      ),
    );
    // Not a shape the grant step admits today; the grouping must still
    // keep a second qualifier apart so its revoke names the right row.
    await store.save(
      row(
        triple(
          { kind: "team", id: "tm_sre", relation: "maintainer" },
          "viewer",
          agent,
        ),
      ),
    );
    const teams: PrincipalDisplay = {
      resolve: () =>
        Promise.resolve(
          new Map([
            [
              "tm_sre",
              create(ApiResourceRefViewSchema, {
                kind: "team",
                id: "tm_sre",
                name: "SRE",
              }),
            ],
          ]),
        ),
    };
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, teams, [
      agent,
    ]);
    expect(
      entries.map((e) => [
        e.principal?.kind,
        e.principal?.id,
        e.principal?.relation,
        e.principal?.name,
      ]),
    ).toEqual([
      ["identity_account", "ida_alice", "", "ida_alice"],
      ["team", "tm_sre", "member", "SRE"],
      ["team", "tm_sre", "maintainer", "SRE"],
    ]);
  });
});

describe("buildPrincipalAccessList: only the organization's people", () => {
  /** An agent in acme: alice (a member) and dave (no role in acme) each hold a viewer grant. */
  async function sharedAgent() {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a1" },
          { kind: "organization", id: "acme" },
        ),
      ),
    );
    await store.save(row(orgRole("ida_alice", "member", "acme")));
    await store.save(row(orgRole("ida_dave", "member", "globex")));
    for (const account of ["ida_alice", "ida_dave"]) {
      await store.save(
        row(
          triple({ kind: "identity_account", id: account }, "viewer", {
            kind: "agent",
            id: "a1",
          }),
        ),
      );
    }
    await store.save(
      row(
        triple({ kind: "team", id: "tm_1", relation: "member" }, "viewer", {
          kind: "agent",
          id: "a1",
        }),
      ),
    );
    return store;
  }

  it("leaves out a person who holds no role in the resource's organization, and keeps teams", async () => {
    const store = await sharedAgent();
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "agent", id: "a1" },
    ]);
    expect(
      entries.map((e) => `${e.principal?.kind}:${e.principal?.id}`),
    ).toEqual(["identity_account:ida_alice", "team:tm_1"]);
  });

  it("reads the organization from the walked hierarchy the same way", async () => {
    const store = await sharedAgent();
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "agent", id: "a1" },
      { kind: "organization", id: "acme" },
    ]);
    expect(entries.map((e) => e.principal?.id)).toEqual(["ida_alice", "tm_1"]);
  });

  it("an organization's own list is its roles and is never filtered", async () => {
    const store = await sharedAgent();
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "organization", id: "globex" },
    ]);
    expect(entries.map((e) => e.principal?.id)).toEqual(["ida_dave"]);
  });

  /** An agent in acme_cust, a child of acme; carol owns it and is one of acme's admins. */
  async function parentAdminsAgent(carolRole: string) {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a2" },
          { kind: "organization", id: "acme_cust" },
        ),
      ),
    );
    await store.save(row(orgRole("ida_carol", carolRole, "acme")));
    await store.save(
      row(
        triple({ kind: "identity_account", id: "ida_carol" }, "owner", {
          kind: "agent",
          id: "a2",
        }),
      ),
    );
    return store;
  }

  it("lists a parent's admin as the owner of what they made in a child, while they are one", async () => {
    for (const role of ["admin", "owner"]) {
      const entries = await buildPrincipalAccessList(
        await parentAdminsAgent(role),
        organizationRows({ acme_cust: "acme", acme: "" }),
        nobody,
        undefined,
        [{ kind: "agent", id: "a2" }],
      );
      expect(entries.map((e) => e.principal?.id)).toEqual(["ida_carol"]);
    }
  });

  it("leaves out a parent's member, and a parent's admin once the child reads as no child", async () => {
    const member = await buildPrincipalAccessList(
      await parentAdminsAgent("member"),
      organizationRows({ acme_cust: "acme", acme: "" }),
      nobody,
      undefined,
      [{ kind: "agent", id: "a2" }],
    );
    expect(member).toEqual([]);
    const unrelated = await buildPrincipalAccessList(
      await parentAdminsAgent("admin"),
      organizationRows({ acme_cust: "", acme: "" }),
      nobody,
      undefined,
      [{ kind: "agent", id: "a2" }],
    );
    expect(unrelated).toEqual([]);
  });

  it("reads no organization row for a resource only teams hold", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        scopeLink(
          { kind: "agent", id: "a3" },
          { kind: "organization", id: "acme_cust" },
        ),
      ),
    );
    await store.save(
      row(
        triple({ kind: "team", id: "tm_2", relation: "member" }, "viewer", {
          kind: "agent",
          id: "a3",
        }),
      ),
    );
    const unread = {
      getResource: () => Promise.reject(new Error("no organization row is read")),
    };
    const entries = await buildPrincipalAccessList(store, unread, nobody, undefined, [
      { kind: "agent", id: "a3" },
    ]);
    expect(entries.map((e) => e.principal?.id)).toEqual(["tm_2"]);
  });

  it("a resource no organization holds is listed as its rows say", async () => {
    const store = fakeGrantStore();
    await store.save(
      row(
        triple({ kind: "identity_account", id: "ida_dave" }, "viewer", {
          kind: "agent",
          id: "loose",
        }),
      ),
    );
    const entries = await buildPrincipalAccessList(store, NO_ORGANIZATIONS, nobody, undefined, [
      { kind: "agent", id: "loose" },
    ]);
    expect(entries.map((e) => e.principal?.id)).toEqual(["ida_dave"]);
  });
});
