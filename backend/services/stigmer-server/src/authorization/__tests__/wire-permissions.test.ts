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
 * Two invariants:
 *   - every `rpc.config` annotation that names a static kind asks a
 *     permission that kind's type defines. A relation the type does not
 *     define answers `deny` in the built-in evaluator and a validation
 *     error in OpenFGA, so such an RPC refuses every caller, dark until
 *     someone runs it under enforcement;
 *   - the permission of every `resource_kind_path` lane (the IamPolicy
 *     lanes, whose kind is the request's) is defined on every kind whose
 *     `kind_meta` lists grantable roles, because each such kind is one the
 *     grant path admits.
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
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor, kindEnumName } from "../../pipeline/apiresource-meta.js";
import { builtInModel } from "../model/index.js";

/**
 * Today's disagreements between the contract and the model, each with its
 * reason. Removing a gap from the model or the contract fails the test
 * until its line is removed here.
 */
const KNOWN_GAPS: ReadonlyArray<string> = [
  // Contract ahead of model, on purpose: Plan's proto says the relation
  // lands in the model with the entry that serves the kind
  // (apis/ai/stigmer/billing/plan/v1/command.proto), and no edition serves
  // Plan yet.
  "ai.stigmer.billing.plan.v1.PlanCommandController/create asks can_manage_plans on platform",
  "ai.stigmer.billing.plan.v1.PlanCommandController/retire asks can_manage_plans on platform",
  // Artifacts are grantable in kind_meta, but the model defines no access
  // relations on them: https://github.com/stigmer/stigmer/issues/1268.
  "the resource_kind_path lanes ask can_grant_access on artifact",
  "the resource_kind_path lanes ask can_view_access on artifact",
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
