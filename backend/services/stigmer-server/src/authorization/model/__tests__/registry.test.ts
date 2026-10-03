/**
 * Pins the built-in model against its sources and the contract:
 *   - its types are the files `fga.mod` lists, in that order, one type per
 *     file named by the file, and every one is bound (bindings.ts);
 *   - every binding's schema is the message `kind_meta` spells for the
 *     kind (`ai.stigmer.<group>.<name>.<version>.<Name>`), `platform`
 *     excepted by name as the one rowless type, so the explicit table
 *     cannot bind a kind to the wrong message;
 *   - every declaration names a `.fga` file that exists under fga/model;
 *   - the model declares every open-source-tier kind, and outside the tier
 *     exactly the four kinds the wider editions serve, so a kind the
 *     contract moves between tiers is a visible diff here;
 *   - a kind is reached by enum and by FGA type name alike;
 *   - every role a kind's `grantable_roles` lets a person hold is a
 *     relation of the kind's type whose direct list admits
 *     `identity_account`, so a grant the step accepts is a tuple the engine
 *     can store (`authorization_config.proto` states the rule; this holds
 *     the model to it);
 *   - the relations whose direct list admits a team (`team#member`) are
 *     exactly the roles the kind's `team_grantable_roles` names, a subset
 *     of what a person can be granted and never ownership, so the grant
 *     step and the model cannot disagree about where a team may be
 *     granted;
 *   - an organization is admitted only as its whole read audience,
 *     `organization#viewer`: a narrower role's userset (the retired
 *     `organization#member` read grant) would leave out every viewer-role
 *     member, and the model's README names the shape as one to avoid;
 *   - the derived rules are exactly the three relations `kind_meta` cannot
 *     derive;
 *   - a kind whose authorization is its parent's whole
 *     (`inheritedAuthorizationParentOf`) holds nothing of its own: its one
 *     direct relation is the parent link, every other relation is built
 *     through it, and its `can_view` answers exactly what the parent's
 *     does, so the list read scope may ask the parent in the child's place
 *     (extensions/list-read-scope.ts) without hiding or showing a row the
 *     child's own check would not.
 *
 * Whether the model defines what the wire asks is the whole contract's
 * question, pinned in __tests__/wire-permissions.test.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ApiResourceGroup } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_group_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  ApiResourceVersion,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  getKindMeta,
  grantableRolesFor,
  inheritedAuthorizationParentOf,
  kindEnumName,
  teamGrantableRolesFor,
} from "../../../pipeline/apiresource-meta.js";
import {
  computed,
  direct,
  from,
  objectOf,
  throwawayDeclaration,
  union,
} from "../../__tests__/throwaway-model.js";
import { KIND_BINDINGS, ROWLESS } from "../bindings.js";
import { builtInModel, declarationFor } from "../index.js";
import type { KindDeclaration, Rewrite, SubjectType } from "../rewrite.js";

/** The server package root, where fga/model lives. */
const PACKAGE_ROOT = new URL("../../../../", import.meta.url);

/** The kinds the model defines outside the open-source tier: the ones the wider editions serve. */
const WIDER_EDITION_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.platform,
  ApiResourceKind.identity_provider,
  ApiResourceKind.invitation,
  ApiResourceKind.team,
];

/** The files `fga.mod` lists, in its order. */
function modFiles(): ReadonlyArray<string> {
  const text = readFileSync(fileURLToPath(new URL("fga/model/fga.mod", PACKAGE_ROOT)), "utf8");
  return [...text.matchAll(/^\s*-\s*(\S+\.fga)\s*$/gm)].map((match) => match[1] ?? "");
}

/** The message `kind_meta` spells for a kind. */
function kindMetaMessageName(kind: ApiResourceKind): string {
  const meta = getKindMeta(kind);
  return [
    "ai",
    "stigmer",
    ApiResourceGroup[meta.group],
    meta.name.toLowerCase(),
    ApiResourceVersion[meta.version],
    meta.name,
  ].join(".");
}

function directSubjects(rewrite: Rewrite): ReadonlyArray<SubjectType> {
  switch (rewrite.node) {
    case "this":
      return rewrite.subjects;
    case "computed":
    case "from":
      return [];
    case "union":
    case "intersection":
      return rewrite.members.flatMap(directSubjects);
    default: {
      const exhaustive: never = rewrite;
      throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The relation every list lane reads through, on the child and on its parent. */
const LIST_RELATION = "can_view";

/** The `this`, `computed` and `from` nodes a rewrite is built from, in the line's order. */
function leavesOf(rewrite: Rewrite): ReadonlyArray<Rewrite> {
  switch (rewrite.node) {
    case "this":
    case "computed":
    case "from":
      return [rewrite];
    case "union":
    case "intersection":
      return rewrite.members.flatMap(leavesOf);
    default: {
      const exhaustive: never = rewrite;
      throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The relations of `declaration` that `relation` includes whole: itself,
 * and every sibling a union member or a computed node names, transitively.
 * An intersection includes none of its members whole, so it stops here.
 */
function includedWhole(declaration: KindDeclaration, relation: string): ReadonlySet<string> {
  const included = new Set<string>();
  const visit = (name: string): void => {
    if (included.has(name)) {
      return;
    }
    included.add(name);
    const walk = (rewrite: Rewrite | undefined): void => {
      if (rewrite?.node === "computed") {
        visit(rewrite.relation);
      } else if (rewrite?.node === "union") {
        rewrite.members.forEach(walk);
      }
    };
    walk(declaration.relations.get(name));
  };
  visit(relation);
  return included;
}

/**
 * The parent relations `relation` of `child` reaches through `link`,
 * following the child's own computed relations to their leaves.
 */
function parentRelationsReached(
  child: KindDeclaration,
  relation: string,
  link: string,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const rewrite = child.relations.get(name);
    for (const leaf of rewrite === undefined ? [] : leavesOf(rewrite)) {
      if (leaf.node === "computed") {
        visit(leaf.relation);
      } else if (leaf.node === "from" && leaf.tupleset === link) {
        reached.add(leaf.relation);
      }
    }
  };
  visit(relation);
  return reached;
}

/**
 * Every way `child` breaks the promise its `kind_meta` makes when it says
 * the kind's authorization is its parent's whole (PARENT scope, INHERITED
 * owner); empty when the model keeps it. The list read scope reads that
 * promise to let a driver ask the parent's `can_view` in the child's
 * place, which gives the child's answer only while:
 *   - the child's one direct relation is the link, to the parent type
 *     alone, so nothing is granted on the child that the parent does not
 *     hold;
 *   - every other relation is built through the link or from the child's
 *     own relations, never from another object;
 *   - the child's `can_view` includes the parent's (`can_view from <link>`
 *     as a union member), so asking the parent hides nothing;
 *   - every parent relation the child's `can_view` reaches is one the
 *     parent's `can_view` includes whole, so asking the parent shows
 *     nothing more.
 * The last reads inclusion structurally (union and computed), so it errs
 * toward a violation: a shape it cannot prove is a design review, never a
 * pass.
 */
function inheritedWholeViolations(
  child: KindDeclaration,
  parent: KindDeclaration,
  link: string,
): ReadonlyArray<string> {
  const violations: string[] = [];
  const linkRewrite = child.relations.get(link);
  const [linked, ...more] = linkRewrite?.node === "this" ? linkRewrite.subjects : [];
  if (linked?.form !== "object" || linked.type !== parent.type || more.length > 0) {
    violations.push(`${child.type}#${link} is not the direct link [${parent.type}] alone`);
  }
  for (const [name, rewrite] of child.relations) {
    if (name === link) {
      continue;
    }
    for (const leaf of leavesOf(rewrite)) {
      if (leaf.node === "this") {
        violations.push(`${child.type}#${name} admits a tuple on the child itself`);
      } else if (leaf.node === "from" && leaf.tupleset !== link) {
        violations.push(
          `${child.type}#${name} reads ${leaf.relation} from ${leaf.tupleset}, not from ${link}`,
        );
      } else if (leaf.node === "computed" && !child.relations.has(leaf.relation)) {
        violations.push(
          `${child.type}#${name} names ${leaf.relation}, which the child does not declare`,
        );
      }
    }
  }
  const childView = child.relations.get(LIST_RELATION);
  if (childView === undefined || !parent.relations.has(LIST_RELATION)) {
    violations.push(`${child.type} and ${parent.type} must both declare ${LIST_RELATION}`);
    return violations;
  }
  const members = childView.node === "union" ? childView.members : [childView];
  if (
    !members.some(
      (member) =>
        member.node === "from" && member.relation === LIST_RELATION && member.tupleset === link,
    )
  ) {
    violations.push(
      `${child.type}#${LIST_RELATION} does not include ${LIST_RELATION} from ${link}`,
    );
  }
  const parentView = includedWhole(parent, LIST_RELATION);
  for (const relation of parentRelationsReached(child, LIST_RELATION, link)) {
    if (!parentView.has(relation)) {
      violations.push(
        `${child.type}#${LIST_RELATION} reaches ${parent.type}#${relation}, which ${parent.type}#${LIST_RELATION} does not include`,
      );
    }
  }
  return violations;
}

/** A declaration the model must hold, or a loud failure naming it. */
function declared(declaration: KindDeclaration | undefined, type: string): KindDeclaration {
  if (declaration === undefined) {
    throw new Error(`${type} is not in the built-in model`);
  }
  return declaration;
}

/** The kinds whose `kind_meta` makes their authorization their parent's whole, with that parent. */
function inheritedWholeKinds(): ReadonlyArray<{
  readonly kind: ApiResourceKind;
  readonly parentType: string;
  readonly link: string;
}> {
  return ApiResourceKindSchema.values.flatMap((value) => {
    const kind = value.number as ApiResourceKind;
    if (kind === ApiResourceKind.api_resource_kind_unknown) {
      return [];
    }
    const parent = inheritedAuthorizationParentOf(kind);
    return parent === undefined ? [] : [{ kind, parentType: parent.kind, link: parent.relation }];
  });
}

function isPerson(subject: SubjectType): boolean {
  return subject.form === "object" && subject.type === "identity_account";
}

function isOrganizationUserset(
  subject: SubjectType,
): subject is Extract<SubjectType, { readonly form: "userset" }> {
  return subject.form === "userset" && subject.type === "organization";
}

function isTeamMembers(subject: SubjectType): boolean {
  return subject.form === "userset" && subject.type === "team" && subject.relation === "member";
}

/** Every kind whose `kind_meta.tier` is the open-source tier. */
function openSourceTierKinds(): ReadonlySet<ApiResourceKind> {
  const kinds = new Set<ApiResourceKind>();
  for (const value of ApiResourceKindSchema.values) {
    const kind = value.number as ApiResourceKind;
    if (
      kind !== ApiResourceKind.api_resource_kind_unknown &&
      getKindMeta(kind).tier === ResourceTier.open_source
    ) {
      kinds.add(kind);
    }
  }
  return kinds;
}

describe("the built-in model", () => {
  it("defines one type per file fga.mod lists, named by the file, in fga.mod order, every one bound", () => {
    const files = modFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(builtInModel.declarations.map((d) => d.type)).toEqual(
      files.map((file) => file.replace(/^.*\//, "").replace(/\.fga$/, "")),
    );
    expect(builtInModel.declarations.map((d) => d.source)).toEqual(
      files.map((file) => `fga/model/${file}`),
    );
    expect([...KIND_BINDINGS.keys()].map(kindEnumName)).toEqual(
      builtInModel.declarations.map((d) => d.type),
    );
  });

  it("binds every kind to the message kind_meta spells, and platform alone to ROWLESS", () => {
    for (const declaration of builtInModel.declarations) {
      if (declaration.kind === ApiResourceKind.platform) {
        expect(declaration.schema).toBe(ROWLESS);
        continue;
      }
      expect(declaration.schema?.typeName, declaration.type).toBe(
        kindMetaMessageName(declaration.kind),
      );
    }
  });

  it("names a .fga source that exists", () => {
    for (const declaration of builtInModel.declarations) {
      expect(
        existsSync(fileURLToPath(new URL(declaration.source, PACKAGE_ROOT))),
        declaration.source,
      ).toBe(true);
    }
  });

  it("defines every open-source-tier kind, and outside the tier exactly the kinds the wider editions serve", () => {
    const declared = new Set(builtInModel.declarations.map((d) => d.kind));
    const tier = openSourceTierKinds();
    for (const kind of tier) {
      expect(declared.has(kind), kindEnumName(kind)).toBe(true);
    }
    expect(
      [...declared].filter((kind) => !tier.has(kind)).map(kindEnumName).sort(),
    ).toEqual(WIDER_EDITION_KINDS.map(kindEnumName).sort());
  });

  it("reaches a declaration by kind and by FGA type name", () => {
    for (const declaration of builtInModel.declarations) {
      expect(declarationFor(declaration.kind)).toBe(declaration);
      expect(builtInModel.byType(kindEnumName(declaration.kind))).toBe(declaration);
    }
    expect(declarationFor(ApiResourceKind.api_resource_kind_unknown)).toBeUndefined();
    expect(builtInModel.byType("")).toBeUndefined();
  });

  it("admits a team exactly on the roles each kind's team_grantable_roles lists — the model and the contract say one thing", () => {
    for (const declaration of builtInModel.declarations) {
      const admitsTeam = [...declaration.relations]
        .filter(([, rewrite]) => directSubjects(rewrite).some(isTeamMembers))
        .map(([relation]) => relation)
        .sort();
      const contract = teamGrantableRolesFor(declaration.kind)
        .map((role) => IamRole[role])
        .sort();
      expect(admitsTeam, declaration.type).toEqual(contract);
    }
  });

  it("admits an organization only as its whole read audience, organization#viewer, never a narrower role's userset", () => {
    const narrower: string[] = [];
    for (const declaration of builtInModel.declarations) {
      for (const [relation, rewrite] of declaration.relations) {
        for (const subject of directSubjects(rewrite).filter(isOrganizationUserset)) {
          if (subject.relation !== "viewer") {
            narrower.push(`${declaration.type}#${relation} admits organization#${subject.relation}`);
          }
        }
      }
    }
    expect(narrower.sort()).toEqual([]);
  });

  it("stores every role a kind lets a person hold as a relation that admits the person directly — the model and the contract say one thing", () => {
    const gaps: string[] = [];
    for (const declaration of builtInModel.declarations) {
      for (const role of grantableRolesFor(declaration.kind)) {
        const relation = IamRole[role];
        const rewrite = declaration.relations.get(relation);
        if (rewrite === undefined || !directSubjects(rewrite).some(isPerson)) {
          gaps.push(`${declaration.type}#${relation}`);
        }
      }
    }
    expect(gaps.sort()).toEqual([]);
  });

  it("lets a team hold only roles a person can hold on the kind, and never ownership", () => {
    for (const value of ApiResourceKindSchema.values) {
      const kind = value.number as ApiResourceKind;
      const person = grantableRolesFor(kind);
      for (const role of teamGrantableRolesFor(kind)) {
        expect(person, `${value.name}: ${IamRole[role]}`).toContain(role);
        expect(role, value.name).not.toBe(IamRole.owner);
      }
    }
  });

  it("carries a derived rule only where kind_meta cannot derive the relation: default_of on the two instance kinds, execution_viewer on the workflow instance", () => {
    const derived = builtInModel.declarations
      .flatMap((d) => [...d.derived.keys()].map((r) => `${d.type}#${r}`))
      .sort();
    expect(derived).toEqual([
      "agent_instance#default_of",
      "workflow_instance#default_of",
      "workflow_instance#execution_viewer",
    ]);
  });

  it("gives a kind whose authorization is its parent's nothing of its own, so asking the parent answers for it", () => {
    const inherited = inheritedWholeKinds();
    expect(inherited.length, "kinds whose authorization is their parent's").toBeGreaterThan(0);
    for (const { kind, parentType, link } of inherited) {
      const child = declared(declarationFor(kind), kindEnumName(kind));
      const parent = declared(builtInModel.byType(parentType), parentType);
      expect(inheritedWholeViolations(child, parent, link), kindEnumName(kind)).toEqual([]);
    }
  });
});

describe("the parent-inheritance walker refuses what would make asking the parent wrong", () => {
  const execution = declared(declarationFor(ApiResourceKind.agent_execution), "agent_execution");
  const session = declared(builtInModel.byType("session"), "session");

  /** agent_execution as the model has it, with one line rewritten. */
  function executionWith(relation: string, rewrite: Rewrite): KindDeclaration {
    return throwawayDeclaration({
      kind: ApiResourceKind.agent_execution,
      relations: [...execution.relations].map(([name, current]) =>
        name === relation ? ([name, rewrite] as const) : ([name, current] as const),
      ),
    });
  }

  it.each([
    {
      shape: "a viewer granted on the execution itself",
      child: executionWith(
        "viewer",
        union(direct(objectOf("identity_account")), from("viewer", "session"), computed("owner")),
      ),
      violation: "agent_execution#viewer admits a tuple on the child itself",
    },
    {
      shape: "a can_view that no longer includes the session's",
      child: executionWith("can_view", computed("viewer")),
      violation: "agent_execution#can_view does not include can_view from session",
    },
    {
      shape: "a can_view reaching a session relation its can_view does not include",
      child: executionWith(
        "can_view",
        union(computed("viewer"), from("can_view", "session"), from("can_delete", "session")),
      ),
      violation:
        "agent_execution#can_view reaches session#can_delete, which session#can_view does not include",
    },
  ])("$shape", ({ child, violation }) => {
    expect(inheritedWholeViolations(child, session, "session")).toEqual([violation]);
  });
});
