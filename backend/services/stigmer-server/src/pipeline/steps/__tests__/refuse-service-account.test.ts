/**
 * Pins RefuseServiceAccountCaller (refuse-service-account.ts): an
 * organization's service account never decides who belongs to the
 * organization or what credentials exist, so the function and its step
 * form refuse the `service_account` caller class with PERMISSION_DENIED
 * and a sentence that names the refused act and who may do it, and pass
 * every other class (a person, a machine, the server's own in-process
 * caller, a runner) untouched. The step refuses before any later step
 * runs, whatever the request names.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { newPipeline } from "../../pipeline.js";
import { RequestContext } from "../../request-context.js";
import {
  newRefuseServiceAccountCallerStep,
  refuseServiceAccountCaller,
  serviceAccountRefusedMessage,
} from "../refuse-service-account.js";

const ACT = "create API keys";

function caller(callerClass: string): CallerIdentity {
  return {
    identityId: "ida_x",
    callerClass,
    issuer: "",
    rawToken: "stk_x",
    ...(callerClass === "service_account" ? { boundOrg: "org_acme" } : {}),
  };
}

function refusalOf(act: () => unknown): ConnectError {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("refuseServiceAccountCaller", () => {
  it("refuses a service account with PERMISSION_DENIED, naming the act and who may do it", () => {
    const refused = refusalOf(() =>
      refuseServiceAccountCaller(caller("service_account"), ACT),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(serviceAccountRefusedMessage(ACT));
    expect(refused.rawMessage).toBe(
      "a service account cannot create API keys; an organization admin must do it",
    );
  });

  it.each(["user", "machine", "internal", "runner"])(
    "passes a %s caller",
    (callerClass) => {
      expect(() =>
        refuseServiceAccountCaller(caller(callerClass), ACT),
      ).not.toThrow();
    },
  );
});

describe("newRefuseServiceAccountCallerStep", () => {
  function chainFor(identity: CallerIdentity) {
    const ctx = new RequestContext(
      ApiKeySchema,
      create(ApiKeySchema, { metadata: { name: "ci" } }),
      identity,
      ApiResourceKind.api_key,
    );
    let laterStepRan = false;
    const run = () =>
      newPipeline<typeof ApiKeySchema>(
        "refuse-service-account-test",
        createLogger({ level: "error", pretty: false, write: () => {} }),
      )
        .addStep(newRefuseServiceAccountCallerStep(ACT))
        .addStep({
          name: "Later",
          execute() {
            laterStepRan = true;
          },
        })
        .build()
        .execute(ctx);
    return { run, laterStepRan: () => laterStepRan };
  }

  it("is named RefuseServiceAccountCaller", () => {
    expect(newRefuseServiceAccountCallerStep(ACT).name).toBe(
      "RefuseServiceAccountCaller",
    );
  });

  it("refuses a service account before any later step runs", async () => {
    const chain = chainFor(caller("service_account"));
    const error = await chain.run().catch((e: unknown) => e);
    const refused = ConnectError.from(error);
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(serviceAccountRefusedMessage(ACT));
    expect(chain.laterStepRan()).toBe(false);
  });

  it.each(["user", "machine", "internal", "runner"])(
    "passes a %s caller on to the next step",
    async (callerClass) => {
      const chain = chainFor(caller(callerClass));
      await chain.run();
      expect(chain.laterStepRan()).toBe(true);
    },
  );
});
