/**
 * Pins the address steps' edges the composed OAuthApp suite cannot reach
 * with a real store: a create refused on a later address lets go of the
 * earlier ones it claimed; a release after the write that fails is logged
 * and never fails the write (the claim is freed by the next app that claims
 * the address); and a deleted app's release that fails is logged the same
 * way.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { oauthAppAddressKey } from "../../vault/login-app.js";
import {
  newClaimAddressesStep,
  newReleaseAddressesStep,
  newReleaseDroppedAddressesStep,
} from "../addresses.js";

const ORG = "org_1";
const FREE = "https://free.example/mcp";
const TAKEN = "https://taken.example/mcp";

let dir: string;
let store: SqliteStore;
let warnings: string[];

const logger = createLogger({
  level: "warn",
  pretty: false,
  write: (line: string) => {
    warnings.push(line);
  },
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oauthapp-addresses-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
  warnings = [];
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function context(addresses: string[], existing?: string[]) {
  const ctx = new RequestContext(
    OAuthAppSchema,
    create(OAuthAppSchema, { metadata: { id: "oap_new", org: ORG }, spec: { addresses } }),
    testCallerIdentity(),
    ApiResourceKind.oauth_app,
  );
  if (existing !== undefined) {
    ctx.set(
      EXISTING_RESOURCE_KEY,
      create(OAuthAppSchema, { metadata: { id: "oap_new", org: ORG }, spec: { addresses: existing } }),
    );
  }
  return ctx;
}

/** The store with its name table's release calls failing. */
function releasesFail(): Store {
  const names = new Proxy(store.resourceNames, {
    get(target, prop, receiver) {
      if (prop === "releaseName" || prop === "release") {
        return () => Promise.reject(new Error("disk gone"));
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "resourceNames") return names;
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Store;
}

describe("the address claims", () => {
  it("a create refused on a later address lets go of the earlier ones it claimed", async () => {
    await store.resourceNames.claim(oauthAppAddressKey(ORG, TAKEN), "oap_other", new Date().toISOString());
    const refused = await Promise.resolve()
      .then(() => newClaimAddressesStep(store, "create").execute(context([FREE, TAKEN])))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.AlreadyExists);
    expect(await store.resourceNames.resolve(oauthAppAddressKey(ORG, FREE), new Date().toISOString())).toBeUndefined();
  });

  it("a release after the write that fails is logged, never thrown", async () => {
    const ctx = context([FREE], [FREE, TAKEN]);
    await newClaimAddressesStep(store, "update").execute(ctx);
    await newReleaseDroppedAddressesStep(releasesFail(), logger).execute(ctx);
    expect(warnings.join("\n")).toContain("an address a login app dropped could not be released");
  });

  it("a deleted app's release that fails is logged, never thrown", async () => {
    const ctx = new RequestContext(OAuthAppSchema, create(OAuthAppSchema), testCallerIdentity(), ApiResourceKind.oauth_app);
    ctx.set(EXISTING_RESOURCE_KEY, create(OAuthAppSchema, { metadata: { id: "oap_gone", org: ORG } }));
    await newReleaseAddressesStep<typeof OAuthAppSchema>(releasesFail(), logger).execute(ctx);
    expect(warnings.join("\n")).toContain("a deleted login app's addresses could not be released");
  });
});
