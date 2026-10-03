/**
 * Pins the contract to the model over the whole wire: every question an
 * RPC annotation asks the authorization model is a relation the model
 * defines. The model (fga/model) and the contract (apis/, reaching this
 * package as `@stigmer/protos`) are both this repository's, so their
 * agreement is this repository's to keep, whichever edition serves the
 * RPC. That is why the scope here is every service in `@stigmer/protos`,
 * where authorize-annotation-completeness.test.ts scopes itself to the
 * methods open source serves: that test governs the Authorize step, and a
 * composition's own services are its own conformance suite's business;
 * this one asks whether the model and the contract say the same thing.
 *
 * Three invariants:
 *   - every `rpc.config` annotation that names a static kind asks a
 *     permission that kind's type defines. A relation the type does not
 *     define answers `deny` in the built-in evaluator and a validation
 *     error in OpenFGA, so such an RPC refuses every caller, dark until
 *     someone runs it under enforcement;
 *   - the permission of every `resource_kind_path` lane (the IamPolicy
 *     lanes, whose kind is the request's) is defined on every kind whose
 *     `kind_meta` lists grantable roles, because each such kind is one the
 *     grant path admits;
 *   - only the grant lanes ask `can_grant_access`. The self-check answers it
 *     false wherever the edition grants no roles on the kind, so an audience
 *     act that asked it would be hidden from its owner there; those ask
 *     `can_manage_audience`.
 *
 * And the reverse, so the model never carries a rule nobody can ask: every
 * `can_*` relation is an `IamPermission` value or is named by the rewrite
 * of a relation that is itself reachable, and every `IamPermission` value
 * is defined by some type. The Authorizer seam and the self-check take
 * only enum values, so a `can_*` relation outside the enum is reachable
 * only through another relation's rewrite; one named only by its own
 * rewrite, or only by other unreachable `can_*` relations, is unreachable
 * in every edition. The rule is by name on purpose: whether code asks a given
 * permission on a given kind is not something this package can see (the
 * console asks the CRUD triple of any kind by name, and an edition's own
 * code asks from outside this repository), so that question stays a
 * review's.
 *
 * Outside the pin, as in the annotation-completeness precedent: `is_public`
 * and `is_skip_authorization` methods (their annotation is never
 * resolved), and a `config` that names no kind (`IamPolicyQueryController.get`,
 * which authorizes the loaded policy's resource).
 *
 * What does not hold today is pinned, never dropped: `KNOWN_GAPS` lists
 * each disagreement, and the test requires the computed list to equal it,
 * so a fix to the model or the contract fails here until its line is
 * removed.
 *
 * The walk reads the stubs' built `dist`. `make test-server` builds them
 * first; a bare `vitest` run in a checkout whose `dist` is stale reads
 * services the contract no longer has.
 */
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { DescService } from "@bufbuild/protobuf";
import { getOption, hasOption } from "@bufbuild/protobuf";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  config as rpcAuthorizationConfig,
  is_public,
  is_skip_authorization,
} from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import { IamPermission, IamPermissionSchema } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor, kindEnumName } from "../../pipeline/apiresource-meta.js";
import { builtInModel } from "../model/index.js";
import type { Rewrite } from "../model/rewrite.js";

/**
 * Today's disagreements between the contract and the model, each with its
 * reason. Removing a gap from the model or the contract fails the test
 * until its line is removed here.
 */
const KNOWN_GAPS: ReadonlyArray<string> = [
  // Artifacts are grantable in kind_meta, but the model defines no access
  // relations on them: https://github.com/stigmer/stigmer/issues/1268.
  "the resource_kind_path lanes ask can_grant_access on artifact",
  "the resource_kind_path lanes ask can_view_access on artifact",
];

/**
 * The RPCs that write grants, the only ones that ask can_grant_access: the
 * IamPolicy lanes and an invitation's create (which carries a role the
 * redeem grants).
 */
const GRANT_LANES: ReadonlyArray<string> = [
  "ai.stigmer.iam.iampolicy.v1.IamPolicyCommandController/create",
  "ai.stigmer.iam.iampolicy.v1.IamPolicyCommandController/delete",
  "ai.stigmer.iam.iampolicy.v1.IamPolicyCommandController/revokeOrgAccess",
  "ai.stigmer.iam.invitation.v1.InvitationCommandController/create",
];

/** One annotated method: the question it asks the model. */
interface WireQuestion {
  readonly method: string;
  /** The static kind, or unknown when the kind is the request's (`kindPath`). */
  readonly kind: ApiResourceKind;
  readonly kindPath: string;
  readonly permission: string;
}

/** Every service descriptor the stubs package exports, loaded through its own specifiers. */
async function everyService(): Promise<ReadonlyArray<DescService>> {
  const require = createRequire(import.meta.url);
  const anchor = "ai/stigmer/iam/v1/enum_pb";
  const resolved = require.resolve(`@stigmer/protos/${anchor}`);
  const dist = resolved.slice(0, resolved.length - `${anchor}.js`.length);
  const modules = readdirSync(path.join(dist, "ai"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("_pb.js"))
    .map((file) => `ai/${file.slice(0, -".js".length).split(path.sep).join("/")}`)
    .sort();
  const services: DescService[] = [];
  for (const specifier of modules) {
    const loaded: Record<string, unknown> = await import(`@stigmer/protos/${specifier}`);
    for (const value of Object.values(loaded)) {
      if (isService(value)) {
        services.push(value);
      }
    }
  }
  return services;
}

function isService(value: unknown): value is DescService {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "service" &&
    "methods" in value
  );
}

/** The model's relations on a kind, or none when the model does not define it. */
function relationsOf(kind: ApiResourceKind): ReadonlySet<string> {
  return new Set(builtInModel.byKind(kind)?.relations.keys() ?? []);
}

describe("the contract asks the model only what the model defines", () => {
  let services: ReadonlyArray<DescService>;

  beforeAll(async () => {
    services = await everyService();
  });

  function annotated(): ReadonlyArray<WireQuestion> {
    const out: WireQuestion[] = [];
    for (const service of services) {
      for (const method of service.methods) {
        if (
          !hasOption(method, rpcAuthorizationConfig) ||
          getOption(method, is_public) ||
          getOption(method, is_skip_authorization)
        ) {
          continue;
        }
        const config = getOption(method, rpcAuthorizationConfig);
        out.push({
          method: `${service.typeName}/${method.name}`,
          kind: config.resourceKind,
          kindPath: config.resourceKindPath,
          permission: IamPermission[config.permission] ?? "",
        });
      }
    }
    return out;
  }

  it("reads the whole contract, the IamPolicy lanes included", () => {
    const questions = annotated();
    expect(services.length).toBeGreaterThan(60);
    expect(questions.length).toBeGreaterThan(150);
    expect(questions.some((q) => q.kindPath !== "")).toBe(true);
  });

  it("asks can_grant_access only on the grant lanes; every other change of who reaches a resource asks can_manage_audience", () => {
    // The self-check answers can_grant_access false on every kind the
    // edition grants no roles on (domain/iampolicy/controller.ts, its second
    // arm), so a console gate that mirrors an RPC asking it hides the control
    // from the owner wherever that holds (stigmer#1495). A new RPC that
    // changes an audience without writing a grant asks can_manage_audience.
    const grantLanes = annotated()
      .filter((q) => q.permission === IamPermission[IamPermission.can_grant_access])
      .map((q) => q.method)
      .sort();
    expect(grantLanes).toEqual(GRANT_LANES);
  });

  it("defines every relation the contract asks about, except the known gaps", () => {
    const questions = annotated();
    const gaps: string[] = [];

    for (const q of questions) {
      if (q.kind !== ApiResourceKind.api_resource_kind_unknown && !relationsOf(q.kind).has(q.permission)) {
        gaps.push(`${q.method} asks ${q.permission} on ${kindEnumName(q.kind)}`);
      }
    }

    const pathPermissions = new Set(
      questions.filter((q) => q.kindPath !== "").map((q) => q.permission),
    );
    for (const value of ApiResourceKindSchema.values) {
      const kind = value.number as ApiResourceKind;
      if (kind === ApiResourceKind.api_resource_kind_unknown || grantableRolesFor(kind).length === 0) {
        continue;
      }
      for (const permission of [...pathPermissions].sort()) {
        if (!relationsOf(kind).has(permission)) {
          gaps.push(`the resource_kind_path lanes ask ${permission} on ${kindEnumName(kind)}`);
        }
      }
    }

    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort());
  });
});

/**
 * The relations a rewrite on `type` refers to. Where the rewrite names the
 * type it lands on (a computed relation of the same type, a userset
 * subject, a tupleset of the same type), the reference is `type#relation`.
 * A `from` arm's relation lands on whatever types the tupleset links to,
 * which the rewrite does not name, so that one is kept by name alone.
 */
function relationsNamedBy(
  rewrite: Rewrite,
  type: string,
  named: { readonly keys: Set<string>; readonly names: Set<string> },
): void {
  switch (rewrite.node) {
    case "this":
      for (const subject of rewrite.subjects) {
        if (subject.form === "userset") {
          named.keys.add(`${subject.type}#${subject.relation}`);
        }
      }
      return;
    case "computed":
      named.keys.add(`${type}#${rewrite.relation}`);
      return;
    case "from":
      named.keys.add(`${type}#${rewrite.tupleset}`);
      named.names.add(rewrite.relation);
      return;
    case "union":
    case "intersection":
      for (const member of rewrite.members) {
        relationsNamedBy(member, type, named);
      }
      return;
    default: {
      const exhaustive: never = rewrite;
      throw new Error(`unknown rewrite node ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe("the model defines only what the contract can ask", () => {
  const permissionNames = new Set(
    IamPermissionSchema.values
      .filter((value) => value.number !== IamPermission.unspecified)
      .map((value) => value.name),
  );

  it("names every can_* relation in the contract's IamPermission, or in the rewrite of a relation that is itself reachable", () => {
    // The suspects start as every can_* relation outside the enum. A
    // suspect is cleared when a relation that is not a suspect names it
    // (as `type#relation`, or by name through a `from` arm), until nothing
    // changes: a suspect's own rewrite, and a ring of suspects naming each
    // other, never clear one.
    let unaskable = new Set<string>();
    for (const declaration of builtInModel.declarations) {
      for (const relation of declaration.relations.keys()) {
        if (relation.startsWith("can_") && !permissionNames.has(relation)) {
          unaskable.add(`${declaration.type}#${relation}`);
        }
      }
    }
    for (;;) {
      const named = { keys: new Set<string>(), names: new Set<string>() };
      for (const declaration of builtInModel.declarations) {
        for (const [relation, rewrite] of declaration.relations) {
          if (!unaskable.has(`${declaration.type}#${relation}`)) {
            relationsNamedBy(rewrite, declaration.type, named);
          }
        }
      }
      const still = new Set(
        [...unaskable].filter(
          (key) => !named.keys.has(key) && !named.names.has(key.slice(key.indexOf("#") + 1)),
        ),
      );
      if (still.size === unaskable.size) {
        break;
      }
      unaskable = still;
    }

    expect([...unaskable].sort()).toEqual([]);
  });

  it("defines every IamPermission value on at least one type", () => {
    const defined = new Set(
      builtInModel.declarations.flatMap((declaration) => [...declaration.relations.keys()]),
    );

    expect([...permissionNames].filter((name) => !defined.has(name)).sort()).toEqual([]);
  });
});
