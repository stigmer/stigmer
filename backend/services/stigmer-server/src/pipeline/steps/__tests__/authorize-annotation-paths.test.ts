/**
 * The annotation-path invariant: every `field_path` and `resource_kind_path`
 * an `rpc.config` annotation names is a real field of its method's input,
 * segment by segment, never through a oneof member (the step reads a
 * member's own property name, which protobuf-es leaves undefined), ending on
 * a value the Authorize step can use.
 *
 * The step reads a path by string (authorize.ts, `resolveDotPath`) and, by
 * doctrine, never throws: a path that names no field resolves to an empty
 * id or the unknown kind. So a stale path fails silently, and in opposite
 * directions per edition: an enforcing authorizer (the cloud's) refuses
 * every caller of the RPC, and the open-source permissive default allows
 * every caller. No typecheck and no `buf` rule reads the string. A renamed
 * field whose annotation was not renamed with it is exactly this shape, and
 * so is a typo in a new annotation.
 *
 * The scope is every method of every service in the contract
 * (contract-support.ts), not only what this server serves: a path is a fact
 * about the contract, and the families most likely to carry one (billing,
 * subscriptions, provider keys) are served only by the cloud composition.
 * Skip and public methods are held to it too: their annotation is not
 * resolved at run time, but a path that names nothing is still a false
 * statement in the contract, and a lane that later stops skipping would
 * inherit it. authorize-annotation-completeness.test.ts holds the sibling
 * rule (a kind always comes with an id).
 *
 * The mutation arms prove the check bites over the same function, on a
 * real descriptor.
 */
import { getOption, hasOption, ScalarType } from "@bufbuild/protobuf";
import type { DescField, DescMessage, DescMethod } from "@bufbuild/protobuf";
import { beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKindSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { config as rpcAuthorizationConfig } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";

import { everyService } from "../../../authorization/__tests__/contract-support.js";

/** The two paths an annotation can name, as the Authorize step reads them. */
interface AnnotationPaths {
  readonly fieldPath: string;
  readonly resourceKindPath: string;
}

/** What a path must end on: an id is a string; a kind is the kind enum or its member name. */
type Terminal = "id" | "kind";

/** Why the path does not resolve on `input`, or undefined when it does. */
function pathProblem(input: DescMessage, path: string, terminal: Terminal): string | undefined {
  const segments = path.split(".");
  let message = input;
  for (const [index, segment] of segments.entries()) {
    const field: DescField | undefined = message.fields.find((f) => f.name === segment);
    if (field === undefined) {
      return `names no field "${segment}" of ${message.typeName}`;
    }
    if (field.oneof !== undefined) {
      // protobuf-es keeps a oneof member under the oneof's { case, value },
      // so the step's property read of the member's own name finds nothing.
      return `names "${segment}" of ${message.typeName}, a member of oneof ${field.oneof.name}, which the Authorize step reads as absent`;
    }
    const last = index === segments.length - 1;
    if (!last) {
      if (field.fieldKind !== "message") {
        return `walks through "${segment}" of ${message.typeName}, which is not a message`;
      }
      message = field.message;
      continue;
    }
    if (terminal === "id" && !(field.fieldKind === "scalar" && field.scalar === ScalarType.STRING)) {
      return `ends on "${segment}" of ${message.typeName}, which is not a string id`;
    }
    if (
      terminal === "kind" &&
      !(field.fieldKind === "scalar" && field.scalar === ScalarType.STRING) &&
      !(field.fieldKind === "enum" && field.enum.typeName === ApiResourceKindSchema.typeName)
    ) {
      return `ends on "${segment}" of ${message.typeName}, which is neither a kind nor a kind's name`;
    }
  }
  return undefined;
}

/** Every path of one method's annotation that does not resolve, one sentence each. */
function unresolvedPaths(method: DescMethod, paths: AnnotationPaths): string[] {
  const name = `${method.parent.typeName}/${method.name}`;
  const problems: string[] = [];
  const checks: ReadonlyArray<readonly [string, string, Terminal]> = [
    ["field_path", paths.fieldPath, "id"],
    ["resource_kind_path", paths.resourceKindPath, "kind"],
  ];
  for (const [option, path, terminal] of checks) {
    if (path === "") continue;
    const problem = pathProblem(method.input, path, terminal);
    if (problem !== undefined) {
      problems.push(`${name} ${option} "${path}" ${problem}`);
    }
  }
  return problems;
}

describe("every authorization annotation's path names a real field of its input", () => {
  let annotated: Array<{ readonly method: DescMethod; readonly paths: AnnotationPaths }>;

  beforeAll(async () => {
    annotated = [];
    for (const service of await everyService()) {
      for (const method of service.methods) {
        if (!hasOption(method, rpcAuthorizationConfig)) continue;
        const config = getOption(method, rpcAuthorizationConfig);
        annotated.push({
          method,
          paths: { fieldPath: config.fieldPath, resourceKindPath: config.resourceKindPath },
        });
      }
    }
  });

  it("reads the whole contract, cloud-served families included", () => {
    const withPath = annotated.filter((a) => a.paths.fieldPath !== "" || a.paths.resourceKindPath !== "");
    expect(withPath.length).toBeGreaterThan(100);
    const services = new Set(withPath.map((a) => a.method.parent.typeName));
    expect(services).toContain("ai.stigmer.billing.v1.BillingQueryController");
  });

  it("no field_path or resource_kind_path names a field its input does not have", () => {
    expect(annotated.flatMap((a) => unresolvedPaths(a.method, a.paths))).toEqual([]);
  });
});

describe("the check bites (mutation proofs over the same function)", () => {
  const create = IamPolicyCommandController.method.create;
  const name = "ai.stigmer.iam.iampolicy.v1.IamPolicyCommandController/create";

  it("the real annotation resolves", () => {
    expect(unresolvedPaths(create, { fieldPath: "resource.id", resourceKindPath: "resource.kind" })).toEqual([]);
  });

  it("a field_path naming no field is reported, by method and path", () => {
    expect(unresolvedPaths(create, { fieldPath: "resource.missing", resourceKindPath: "" })).toEqual([
      `${name} field_path "resource.missing" names no field "missing" of ai.stigmer.iam.iampolicy.v1.ApiResourceRef`,
    ]);
  });

  it("a resource_kind_path naming no field is reported", () => {
    expect(unresolvedPaths(create, { fieldPath: "", resourceKindPath: "target.kind" })).toEqual([
      `${name} resource_kind_path "target.kind" names no field "target" of ${create.input.typeName}`,
    ]);
  });

  it("a path that walks through a scalar is reported", () => {
    expect(unresolvedPaths(create, { fieldPath: "resource.id.value", resourceKindPath: "" })).toEqual([
      `${name} field_path "resource.id.value" walks through "id" of ai.stigmer.iam.iampolicy.v1.ApiResourceRef, which is not a message`,
    ]);
  });

  it("a path through a oneof member is reported: the step cannot read it", () => {
    const scheduleCreate = ScheduleCommandController.method.create;
    expect(unresolvedPaths(scheduleCreate, { fieldPath: "spec.agent.message", resourceKindPath: "" })).toEqual([
      `ai.stigmer.agentic.schedule.v1.ScheduleCommandController/create field_path "spec.agent.message" names "agent" of ai.stigmer.agentic.schedule.v1.ScheduleSpec, a member of oneof target, which the Authorize step reads as absent`,
    ]);
  });

  it("a field_path that ends on a message, not a string id, is reported", () => {
    expect(unresolvedPaths(create, { fieldPath: "resource", resourceKindPath: "" })).toEqual([
      `${name} field_path "resource" ends on "resource" of ${create.input.typeName}, which is not a string id`,
    ]);
  });
});
