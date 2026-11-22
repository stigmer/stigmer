/**
 * The custom-tools steps on their own: a request with no stored session
 * (a create reaching the update's step) passes the lock untouched, before
 * any store read, and a declaration the shared check refuses is
 * INVALID_ARGUMENT with its sentence. The wire-level behaviour is
 * `session.test.ts`'s custom_tools block.
 */

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { newValidateCustomToolsImmutabilityStep, newValidateCustomToolsStep } from "../custom-tools.js";

function contextWith(customTools: { name: string; description: string; inputSchema: Record<string, never> | { type: string } }[]) {
  return new RequestContext(
    SessionSchema,
    create(SessionSchema, { metadata: { org: "acme", name: "s" }, spec: { customTools: customTools as never } }),
    testCallerIdentity({ identityId: "acc_owner" }),
    ApiResourceKind.session,
  );
}

describe("the custom-tools steps", () => {
  it("leave a request with no stored session to the create path, reading nothing", async () => {
    const store = new Proxy({} as Store, {
      get() {
        throw new Error("the lock read the store");
      },
    });
    await expect(newValidateCustomToolsImmutabilityStep(store).execute(contextWith([{ name: "a", description: "d", inputSchema: { type: "object" } }]))).resolves.toBeUndefined();
  });

  it("refuse a declaration the shared check refuses with its sentence", () => {
    let refused: unknown;
    try {
      newValidateCustomToolsStep().execute(contextWith([{ name: "Read", description: "d", inputSchema: { type: "object" } }]));
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.InvalidArgument);
    expect((refused as ConnectError).rawMessage).toBe("The name of custom tool 'Read' is a built-in tool's; choose another.");
  });
});
