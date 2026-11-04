/**
 * Pins RefuseServiceAccountCaller (refuse-service-account.ts): an
 * organization's service account never decides who belongs to the
 * organization or what credentials exist. Who is a service account is the
 * principal's fact:
 *
 *   - a credential for one piece of work (a run's, class `runner`, and every
 *     lane class an edition mints) is refused with no read, whatever row it
 *     names: it acts as its person with the person's whole role, and must
 *     not outlive its work as a key or a membership change (stigmer#2946);
 *   - the `service_account` class is refused with no read;
 *   - a person's own or a machine credential that speaks for a service
 *     account's row is refused too, read once by id;
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

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { newPipeline } from "../../pipeline.js";
import { RequestContext } from "../../request-context.js";
import {
  newRefuseServiceAccountCallerStep,
  refuseServiceAccountCaller,
  serviceAccountRefusedMessage,
  speaksForOnePieceOfWork,
  workCredentialRefusedMessage,
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

  it.each(["runner", "embedded_runner", "session", "guest", "connect"])(
    "refuses a %s credential, a credential for one piece of work, with no read, whatever it speaks for",
    async (callerClass) => {
      for (const identityId of [PERSON_ID, SERVICE_ACCOUNT_ID, "auth0|ana"]) {
        const rows = lookup();
        const refused = await refusalOf(refuseServiceAccountCaller(caller(callerClass, identityId), ACT, rows));
        expect(refused.code).toBe(Code.PermissionDenied);
        expect(refused.rawMessage).toBe(
          "a credential for one run or lane cannot create API keys; the person must do it signed in as themselves",
        );
        expect(refused.rawMessage).toBe(workCredentialRefusedMessage(ACT));
        expect(rows.reads()).toBe(0);
      }
    },
  );

  it("admits a request the server composed for a run's credential (it entered in-process)", async () => {
    const composed = { ...caller("runner", PERSON_ID), origin: "in-process" as const };
    expect(speaksForOnePieceOfWork(composed)).toBe(false);
    await expect(refuseServiceAccountCaller(composed, ACT, lookup())).resolves.toBeUndefined();
  });

  it.each(["user", "machine"])(
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
    ["an id no account holds", "user", "ida_gone", 1],
    ["a machine account", "machine", "ida_platform", 1],
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
    const chain = chainFor(caller("user", SERVICE_ACCOUNT_ID));
    const refused = ConnectError.from(await chain.run().catch((e: unknown) => e));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(serviceAccountRefusedMessage(ACT));
    expect(chain.laterStepRan()).toBe(false);
  });

  it("refuses a run's credential before any later step runs", async () => {
    const chain = chainFor(caller("runner", PERSON_ID));
    const refused = ConnectError.from(await chain.run().catch((e: unknown) => e));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(workCredentialRefusedMessage(ACT));
    expect(chain.laterStepRan()).toBe(false);
  });

  it("passes a person on to the next step", async () => {
    const chain = chainFor(caller("user", PERSON_ID));
    await chain.run();
    expect(chain.laterStepRan()).toBe(true);
  });
});
