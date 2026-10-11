/**
 * Pins RefuseServiceAccountCaller (refuse-service-account.ts): an
 * organization's service account never decides who belongs to the
 * organization or what credentials exist. Who is a service account is the
 * principal's fact:
 *
 *   - the `service_account` class is refused with no read;
 *   - any other credential that speaks for a service account's row is
 *     refused too (a run's own credential, class `runner`, acting as the
 *     run's creator; an edition's runner token), read once by id;
 *   - a person's row, an id that names no account, an id not shaped like
 *     an account id, and the server's own `internal` caller pass, the last
 *     two with no read;
 *   - a store fault is INTERNAL, never "a person".
 *
 * The refusal is PERMISSION_DENIED with a sentence naming the refused act
 * and who may do it, and the step refuses before any later step runs.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { newPipeline } from "../../pipeline.js";
import { RequestContext } from "../../request-context.js";
import {
  newRefuseServiceAccountCallerStep,
  refuseServiceAccountCaller,
  serviceAccountRefusedMessage,
} from "../refuse-service-account.js";
import type { ServiceAccountLookup } from "../refuse-service-account.js";

const ACT = "create API keys";
const SERVICE_ACCOUNT_ID = "ida_ci";
const PERSON_ID = "ida_ana";

const ROWS: ReadonlyMap<string, IdentityAccount> = new Map([
  [
    SERVICE_ACCOUNT_ID,
    create(IdentityAccountSchema, {
      metadata: { id: SERVICE_ACCOUNT_ID, org: "org_acme" },
      spec: { idpId: "stgm_sa|org_acme|0f", provisioningMode: IdentityAccountProvisioningMode.service_account },
    }),
  ],
  [
    PERSON_ID,
    create(IdentityAccountSchema, {
      metadata: { id: PERSON_ID },
      spec: { idpId: "auth0|ana", provisioningMode: IdentityAccountProvisioningMode.direct },
    }),
  ],
]);

/** A lookup over ROWS that counts its reads. */
function lookup(): ServiceAccountLookup & { reads: () => number } {
  let reads = 0;
  return {
    findById(id) {
      reads++;
      return Promise.resolve(ROWS.get(id));
    },
    reads: () => reads,
  };
}

function caller(callerClass: string, identityId: string): CallerIdentity {
  return { identityId, callerClass, issuer: "", rawToken: "stk_x" };
}

async function refusalOf(work: Promise<unknown>): Promise<ConnectError> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return ConnectError.from(error);
}

describe("refuseServiceAccountCaller", () => {
  it("refuses the service_account class with PERMISSION_DENIED and no read, naming the act and who may do it", async () => {
    const rows = lookup();
    const refused = await refusalOf(refuseServiceAccountCaller(caller("service_account", "ida_anything"), ACT, rows));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(
      "a service account cannot create API keys; an organization admin must do it",
    );
    expect(rows.reads()).toBe(0);
  });

  it.each(["runner", "user", "embedded_runner", "machine"])(
    "refuses a %s credential that speaks for a service account's row",
    async (callerClass) => {
      const refused = await refusalOf(
        refuseServiceAccountCaller(caller(callerClass, SERVICE_ACCOUNT_ID), ACT, lookup()),
      );
      expect(refused.code).toBe(Code.PermissionDenied);
      expect(refused.rawMessage).toBe(serviceAccountRefusedMessage(ACT));
    },
  );

  it.each([
    ["a person's row", "user", PERSON_ID, 1],
    ["an id no account holds", "runner", "ida_gone", 1],
    ["an unprovisioned subject", "user", "auth0|newcomer", 0],
    ["the server itself", "internal", SERVICE_ACCOUNT_ID, 0],
  ] as const)("passes %s", async (_label, callerClass, identityId, reads) => {
    const rows = lookup();
    await expect(refuseServiceAccountCaller(caller(callerClass, identityId), ACT, rows)).resolves.toBeUndefined();
    expect(rows.reads()).toBe(reads);
  });

  it("answers a store fault INTERNAL, never as a person", async () => {
    const failing: ServiceAccountLookup = { findById: () => Promise.reject(new Error("store down")) };
    const refused = await refusalOf(refuseServiceAccountCaller(caller("user", PERSON_ID), ACT, failing));
    expect(refused.code).toBe(Code.Internal);
  });
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
        .addStep(newRefuseServiceAccountCallerStep(ACT, lookup()))
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
    expect(newRefuseServiceAccountCallerStep(ACT, lookup()).name).toBe("RefuseServiceAccountCaller");
  });

  it("refuses a credential speaking for a service account before any later step runs", async () => {
    const chain = chainFor(caller("runner", SERVICE_ACCOUNT_ID));
    const refused = ConnectError.from(await chain.run().catch((e: unknown) => e));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(serviceAccountRefusedMessage(ACT));
    expect(chain.laterStepRan()).toBe(false);
  });

  it("passes a person on to the next step", async () => {
    const chain = chainFor(caller("user", PERSON_ID));
    await chain.run();
    expect(chain.laterStepRan()).toBe(true);
  });
});
