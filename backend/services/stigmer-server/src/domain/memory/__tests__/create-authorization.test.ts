/**
 * Pins the create lane's authorization question (steps.ts,
 * resolveMemoryCreateTargets): a wire caller asks can_create_session on
 * metadata.org — whoever may converse in an organization may remember
 * there — and a server-composed request (internal, or any identity that
 * entered in-process) asks nothing, as the capture gate before it already
 * says.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  MEMORY_CREATE_DENIED_MESSAGE,
  resolveMemoryCreateTargets,
} from "../steps.js";

function ctxFor(caller: CallerIdentity) {
  return new RequestContext(
    MemorySchema,
    create(MemorySchema, { metadata: { name: "prefers-tea", org: "acme" } }),
    caller,
    ApiResourceKind.memory,
  );
}

describe("resolveMemoryCreateTargets", () => {
  it("a wire caller asks can_create_session on the memory's organization", () => {
    expect(resolveMemoryCreateTargets(ctxFor(testCallerIdentity()))).toEqual([
      {
        permission: IamPermission.can_create_session,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
        deniedMessage: MEMORY_CREATE_DENIED_MESSAGE,
      },
    ]);
  });

  it("a server-composed request asks nothing", () => {
    expect(
      resolveMemoryCreateTargets(
        ctxFor(testCallerIdentity({ callerClass: "internal" })),
      ),
    ).toEqual([]);
    expect(
      resolveMemoryCreateTargets(
        ctxFor(
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
        ),
      ),
    ).toEqual([]);
  });
});
