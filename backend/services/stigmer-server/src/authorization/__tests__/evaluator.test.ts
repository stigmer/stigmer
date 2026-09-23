/**
 * Pins the evaluator's semantics the store tests cannot express (the
 * cloud's `.fga.yaml` documents prove the model's answers; this file
 * proves the machinery under them): how a person matches a tuple, that a
 * direct tuple outside the line's type restriction is ignored (model drift
 * fails closed), how far a resolution may walk, that an intersection
 * holds only while every member does (the team bound) and stops at its
 * first false member, that `declareKind` refuses a line a `.fga` file
 * could not hold, and that a declaration cycle or an undeclared target is
 * a thrown fault and never a silent deny.
 *
 * The fixture source is the in-memory one the store-test kit uses, so the
 * two proofs share one tuple vocabulary. Where a case needs a shape the
 * real model does not have (a cycle, a chain past the depth bound), it
 * declares a throwaway model with `declareKind`; everything else runs
 * over the built-in model so the fixtures are real relations.
 */
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  AuthorizationEvaluationError,
  MAX_RESOLUTION_DEPTH,
  checkRelation,
} from "../evaluator.js";
import { builtInModel, newModel } from "../model/index.js";
import {
  computed,
  declareKind,
  direct,
  from,
  intersection,
  objectOf,
  union,
  usersetOf,
} from "../model/rewrite.js";
import type { Rewrite } from "../model/rewrite.js";
import type { Person, Tuple, TupleSource } from "../tuples.js";
import {
  newInMemoryTupleSource,
  parseObjectRef,
  parseSubject,
} from "../tuples.js";

/** `object#relation@subject` in the FGA tuple notation, the fixtures' own spelling. */
function tuple(text: string): Tuple {
  const [objectAndRelation, subject] = text.split("@") as [string, string];
  const [object, relation] = objectAndRelation.split("#") as [string, string];
  return {
    object: parseObjectRef(object),
    relation,
    subject: parseSubject(subject),
  };
}

function person(accountId: string, ...aliases: string[]): Person {
  return { accountId, aliases: new Set([accountId, ...aliases]) };
}

async function allowed(
  source: TupleSource,
  object: string,
  relation: string,
  who: Person,
): Promise<boolean> {
  return checkRelation(
    { model: builtInModel, source },
    parseObjectRef(object),
    relation,
    who,
  );
}

describe("a person against a direct tuple", () => {
  const source = newInMemoryTupleSource([
    tuple("agent:a#organization@organization:acme"),
    tuple("agent:a#owner@identity_account:auth0|carol"),
  ]);

  it("matches on any alias, so a row stamped with the 3.14 issuer subject is still its creator's", async () => {
    const carol = person("ida_carol", "auth0|carol");
    expect(await allowed(source, "agent:a", "can_edit", carol)).toBe(true);
    expect(
      await allowed(source, "agent:a", "can_edit", person("ida_carol")),
    ).toBe(false);
  });

  it("a tuple naming the empty stamp or the laptop's `system` placeholder reaches no person — the derivation never emits one, and `personFor` never builds one (tuples.test.ts)", async () => {
    const stamped = newInMemoryTupleSource([
      tuple("agent:b#owner@identity_account:"),
      tuple("agent:c#owner@identity_account:system"),
    ]);
    const someone = person("ida_someone", "auth0|someone");
    expect(await allowed(stamped, "agent:b", "can_edit", someone)).toBe(false);
    expect(await allowed(stamped, "agent:c", "can_edit", someone)).toBe(false);
  });
});

describe("a stranger against a row with no grant that names them", () => {
  it("reads nothing: no subject form reaches every account, so a stranger holds no relation on a row they were not granted", async () => {
    const source = newInMemoryTupleSource([
      tuple("agent:open#organization@organization:acme"),
      tuple("agent:open#owner@identity_account:ida_carol"),
      tuple("agent:open#viewer@organization:acme#viewer"),
    ]);
    const stranger = person("ida_mallory");
    expect(await allowed(source, "agent:open", "can_view", stranger)).toBe(
      false,
    );
  });
});

describe("type restrictions on a direct line", () => {
  it("honours a userset subject only where the line lists it — `organization.owner` is `[identity_account]`, so another organization's member userset on it grants nothing", async () => {
    // A tuple the cloud could never have written (the write would be
    // rejected by the type restriction); the evaluator refuses it the
    // same way, so a derivation that drifts from the model denies
    // instead of allowing.
    const source = newInMemoryTupleSource([
      tuple("organization:acme#member@identity_account:ida_dave"),
      tuple("organization:other#owner@organization:acme#member"),
    ]);
    expect(
      await allowed(
        source,
        "organization:other",
        "can_delete",
        person("ida_dave"),
      ),
    ).toBe(false);
  });

  it("resolves an allowed userset through the parent's own relation, ladder included", async () => {
    const source = newInMemoryTupleSource([
      tuple("organization:acme#owner@identity_account:ida_root"),
      tuple("agent:team#organization@organization:acme"),
      tuple("agent:team#viewer@organization:acme#viewer"),
    ]);
    // owner ⊂ admin ⊂ member ⊂ viewer: the owner satisfies organization#viewer.
    expect(
      await allowed(source, "agent:team", "can_view", person("ida_root")),
    ).toBe(true);
  });
});

describe("relations and kinds the model does not declare", () => {
  const source = newInMemoryTupleSource([
    tuple("agent:a#organization@organization:acme"),
    tuple("agent:a#owner@identity_account:ida_carol"),
  ]);

  it("an undeclared relation on a declared kind is false — the ruled answer: deny, never INTERNAL", async () => {
    expect(
      await allowed(source, "agent:a", "can_read_secrets", person("ida_carol")),
    ).toBe(false);
  });

  it("an undeclared kind as the TARGET is a thrown fault — the driver refused unserved kinds before, so reaching here is a registry gap", async () => {
    await expect(
      allowed(source, "identity_provider:idp", "can_view", person("ida_carol")),
    ).rejects.toMatchObject({ reason: "undeclared-target-kind" });
  });

  it("an undeclared kind reached through a hop yields nothing — `agent.platform_viewer` walks `identity_provider#platform_user`", async () => {
    const platform = newInMemoryTupleSource([
      tuple("agent:p#organization@organization:acme"),
      tuple("agent:p#platform_viewer@identity_provider:idp#platform_user"),
    ]);
    expect(
      await allowed(platform, "agent:p", "can_view", person("ida_zed")),
    ).toBe(false);
  });
});

describe("the walk itself", () => {
  it("asks the source once per (object, relation) — the memo — and stops at the first true member of a union", async () => {
    const asked: string[] = [];
    const inner = newInMemoryTupleSource([
      tuple("organization:acme#owner@identity_account:ida_root"),
      tuple("agent:a#organization@organization:acme"),
      tuple("agent:a#owner@identity_account:ida_carol"),
    ]);
    const counting: TupleSource = {
      tuplesOf(object, relation) {
        asked.push(`${object.type}:${object.id}#${relation}`);
        return inner.tuplesOf(object, relation);
      },
    };
    // can_view → viewer → this | owner | platform_viewer; owner → this | admin from organization;
    // organization.admin → this | owner; organization.owner → this (root: true).
    expect(
      await allowed(counting, "agent:a", "can_view", person("ida_root")),
    ).toBe(true);
    const distinct = new Set(asked);
    expect(asked.length, `each pair asked once: ${asked.join(", ")}`).toBe(
      distinct.size,
    );
    // The platform_viewer arm sits AFTER owner in the union and is never reached.
    expect(asked).not.toContain("agent:a#platform_viewer");
  });

  it("bounds the resolution at OpenFGA's own limit and reports the overrun as a fault", async () => {
    // A chain of `next from link` deeper than the bound, on a throwaway model.
    const deep = declareKind({
      kind: ApiResourceKind.agent,
      schema: AgentSchema,
      source: "test/deep.fga",
      relations: [
        ["link", direct(objectOf("agent"))],
        [
          "next",
          union(direct(objectOf("identity_account")), from("next", "link")),
        ],
      ],
    });
    const chain: Tuple[] = [];
    for (let i = 0; i < MAX_RESOLUTION_DEPTH + 2; i += 1) {
      chain.push(tuple(`agent:n${i}#link@agent:n${i + 1}`));
    }
    await expect(
      checkRelation(
        { model: newModel([deep]), source: newInMemoryTupleSource(chain) },
        parseObjectRef("agent:n0"),
        "next",
        person("ida_nobody"),
      ),
    ).rejects.toMatchObject({ reason: "resolution-depth-exceeded" });
  });

  it("an intersection holds only while every member does — a team member reaches a team grant only while still an organization viewer", async () => {
    // The Enterprise team type, declared here because open source serves
    // no team: membership bounded by the organization's viewers.
    const team = declareKind({
      kind: ApiResourceKind.team,
      schema: AgentSchema,
      source: "test/team.fga",
      relations: [
        ["organization", direct(objectOf("organization"))],
        [
          "member",
          intersection(
            direct(objectOf("identity_account")),
            from("viewer", "organization"),
          ),
        ],
      ],
    });
    const source = newInMemoryTupleSource([
      tuple("organization:acme#viewer@identity_account:ida_vic"),
      tuple("team:sre#organization@organization:acme"),
      tuple("team:sre#member@identity_account:ida_vic"),
      tuple("team:sre#member@identity_account:ida_left"),
      tuple("agent:a#organization@organization:acme"),
      tuple("agent:a#viewer@team:sre#member"),
    ]);
    const model = newModel([...builtInModel.declarations, team]);
    const check = (who: Person): Promise<boolean> =>
      checkRelation(
        { model, source },
        parseObjectRef("agent:a"),
        "can_view",
        who,
      );
    expect(await check(person("ida_vic"))).toBe(true);
    // A team row with no organization role left: the bound ends the grant.
    expect(await check(person("ida_left"))).toBe(false);
    expect(await check(person("ida_nobody"))).toBe(false);
  });

  it("an intersection stops at its first false member — the direct arm is read before the hop that bounds it", async () => {
    const team = declareKind({
      kind: ApiResourceKind.team,
      schema: AgentSchema,
      source: "test/team.fga",
      relations: [
        ["organization", direct(objectOf("organization"))],
        [
          "member",
          intersection(
            direct(objectOf("identity_account")),
            from("viewer", "organization"),
          ),
        ],
      ],
    });
    const asked: string[] = [];
    const inner = newInMemoryTupleSource([
      tuple("team:sre#organization@organization:acme"),
    ]);
    const counting: TupleSource = {
      tuplesOf(object, relation) {
        asked.push(`${object.type}:${object.id}#${relation}`);
        return inner.tuplesOf(object, relation);
      },
    };
    expect(
      await checkRelation(
        { model: newModel([team]), source: counting },
        parseObjectRef("team:sre"),
        "member",
        person("ida_nobody"),
      ),
    ).toBe(false);
    expect(asked).toEqual(["team:sre#member"]);
  });

  it("a declaration that re-enters itself on one object is a cycle fault, never a silent false", async () => {
    const cyclic = declareKind({
      kind: ApiResourceKind.agent,
      schema: AgentSchema,
      source: "test/cyclic.fga",
      relations: [
        ["a", computed("b")],
        ["b", computed("a")],
      ],
    });
    await expect(
      checkRelation(
        { model: newModel([cyclic]), source: newInMemoryTupleSource([]) },
        parseObjectRef("agent:x"),
        "a",
        person("ida_nobody"),
      ),
    ).rejects.toBeInstanceOf(AuthorizationEvaluationError);
  });
});

describe("declareKind validates a transcript at load", () => {
  it("refuses a computed or tupleset reference to a relation the kind does not declare", () => {
    expect(() =>
      declareKind({
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        source: "test/bad.fga",
        relations: [["can_view", computed("viewer")]],
      }),
    ).toThrow("relation 'viewer'");
    expect(() =>
      declareKind({
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        source: "test/bad.fga",
        relations: [["owner", from("admin", "organization")]],
      }),
    ).toThrow("tupleset 'organization'");
  });

  it("refuses a relation declared twice", () => {
    expect(() =>
      declareKind({
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        source: "test/bad.fga",
        relations: [
          ["viewer", direct(objectOf("identity_account"))],
          ["viewer", direct(usersetOf("organization", "viewer"))],
        ],
      }),
    ).toThrow("declared twice");
  });

  it("refuses a line no .fga file could hold without parentheses, and an operator over one member", () => {
    const declare = (rewrite: Rewrite) =>
      declareKind({
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        source: "test/bad.fga",
        relations: [
          ["organization", direct(objectOf("organization"))],
          ["viewer", rewrite],
        ],
      });
    expect(() =>
      declare(
        intersection(
          union(direct(objectOf("identity_account")), computed("organization")),
          from("viewer", "organization"),
        ),
      ),
    ).toThrow("nests or inside and");
    expect(() =>
      declare(
        union(
          intersection(
            direct(objectOf("identity_account")),
            from("viewer", "organization"),
          ),
          computed("organization"),
        ),
      ),
    ).toThrow("nests and inside or");
    expect(() =>
      declare(intersection(direct(objectOf("identity_account")))),
    ).toThrow("fewer than two members");
    expect(() =>
      declare(
        intersection(
          direct(objectOf("identity_account")),
          from("viewer", "organization"),
        ),
      ),
    ).not.toThrow();
  });

  it("carries the FGA type name of its kind and its relations in file order", () => {
    const declaration = declareKind({
      kind: ApiResourceKind.mcp_server,
      schema: AgentSchema,
      source: "test/order.fga",
      relations: [
        ["organization", direct(objectOf("organization"))],
        ["owner", direct(usersetOf("organization", "admin"))],
        ["can_edit", computed("owner")],
      ],
    });
    expect(declaration.type).toBe("mcp_server");
    expect([...declaration.relations.keys()]).toEqual([
      "organization",
      "owner",
      "can_edit",
    ]);
  });
});
