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
 *   - the relations whose direct list admits a team (`team#member`) are
 *     exactly the roles the kind's `team_grantable_roles` names, a subset
 *     of what a person can be granted and never ownership, so the grant
 *     step and the model cannot disagree about where a team may be
 *     granted;
 *   - the derived rules are exactly the three relations `kind_meta` cannot
 *     derive.
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
  kindEnumName,
  teamGrantableRolesFor,
} from "../../../pipeline/apiresource-meta.js";
import { KIND_BINDINGS, ROWLESS } from "../bindings.js";
import { builtInModel, declarationFor } from "../index.js";
import type { Rewrite, SubjectType } from "../rewrite.js";

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
});
