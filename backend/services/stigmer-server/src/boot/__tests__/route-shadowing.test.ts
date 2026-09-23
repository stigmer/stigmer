/**
 * Pins the routes stage's refusal of a shadowing registration: Connect's
 * router lets the last registration of a path win silently, so an
 * extension that registers a service the core already serves — or that
 * another extension already registered — must fail boot, naming itself and
 * whoever serves the path. Distinct services pass untouched, in order.
 */
import { createConnectRouter } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { OAuthAppQueryController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/query_pb";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";

import { registerExtensionServicesUnshadowed } from "../route-shadowing.js";

describe("registerExtensionServicesUnshadowed", () => {
  it("refuses an extension service the core already serves, naming the unit and the path", () => {
    const router = createConnectRouter();
    router.service(PlatformClientTokenController, {});
    expect(() =>
      registerExtensionServicesUnshadowed(router, [
        { unit: "cloud-iam", register: (r) => void r.service(PlatformClientTokenController, {}) },
      ]),
    ).toThrow(
      /extension 'cloud-iam' registers \/ai\.stigmer\.iam\.platformclient\.v1\.PlatformClientTokenController\/mintUserToken, which the core already serves/,
    );
  });

  it("refuses a second extension registering what a first one did", () => {
    const router = createConnectRouter();
    expect(() =>
      registerExtensionServicesUnshadowed(router, [
        { unit: "first", register: (r) => void r.service(OAuthAppQueryController, {}) },
        { unit: "second", register: (r) => void r.rpc(OAuthAppQueryController.method.get, () => {
          throw new Error("never called");
        }) },
      ]),
    ).toThrow(/extension 'second' registers .*OAuthAppQueryController\/get, which extension 'first' already serves/);
  });

  it("registers distinct services from every unit", () => {
    const router = createConnectRouter();
    router.service(OAuthAppQueryController, {});
    registerExtensionServicesUnshadowed(router, [
      { unit: "billing", register: (r) => void r.service(PlatformClientQueryController, {}) },
    ]);
    expect(router.handlers.map((handler) => handler.requestPath)).toContain(
      "/ai.stigmer.iam.platformclient.v1.PlatformClientQueryController/listByOrg",
    );
  });
});
