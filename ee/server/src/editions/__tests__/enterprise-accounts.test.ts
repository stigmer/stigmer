/**
 * The self-hosted Enterprise server's account service
 * (editions/enterprise-accounts.ts) over a hand-built hand-over, without a
 * database: what its Postgres suite (enterprise-accounts.postgres.test.ts,
 * the account surface's contract kit) cannot reach.
 *
 *   - the store a lane takes before the hand-over forwards every member to
 *     the composition's binding at call time, and refuses a call before it;
 *   - a create refuses an account that is not federated, and one made
 *     acting for no provider, before it reaches the library; a fault that is
 *     not ALREADY_EXISTS comes back as it was;
 *   - a delete refuses before the hand-over, rethrows a fault that is not
 *     NOT_FOUND from the library's delete, and names nobody when the server
 *     acts for no one.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { GrantCommandController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/command_pb";
import type { ComposedIdentityAccounts, IdentityAccountStore } from "@stigmer/server";
import { IN_PROCESS_CALLER_HEADER } from "@stigmer/server";

import type { NewAccountRequest } from "../../iam/account/port.js";
import { newEnterpriseAccounts } from "../enterprise-accounts.js";

/** A store whose every member records its name and answers its result. */
function recordingStore(called: string[]): IdentityAccountStore {
  const account = create(IdentityAccountSchema, { metadata: { id: "ida_found" } });
  return {
    save: () => (called.push("save"), Promise.resolve()),
    readForWrite: () => (called.push("readForWrite"), Promise.resolve(undefined)),
    swap: () => (called.push("swap"), Promise.resolve(false)),
    deleteById: () => (called.push("deleteById"), Promise.resolve()),
    findById: () => (called.push("findById"), Promise.resolve(account)),
    findByIdpId: () => (called.push("findByIdpId"), Promise.resolve(account)),
    findDirectByIdpId: () => (called.push("findDirectByIdpId"), Promise.resolve(account)),
    findDirectByEmail: () => (called.push("findDirectByEmail"), Promise.resolve(account)),
    findByIds: () => (called.push("findByIds"), Promise.resolve([account])),
    findByIssuerAndIdpId: () => (called.push("findByIssuerAndIdpId"), Promise.resolve(account)),
    findByIssuer: () => (called.push("findByIssuer"), Promise.resolve([account])),
    findByOrg: () => (called.push("findByOrg"), Promise.resolve([account])),
  };
}

function federatedRequest(): NewAccountRequest {
  return {
    org: "org_acme",
    name: "dana@acme.example",
    spec: create(IdentityAccountSpecSchema, {
      idpId: "okta|dana",
      email: "dana@acme.example",
      provisioningMode: IdentityAccountProvisioningMode.federated,
      federationIssuerRef: { org: "org_acme", slug: "acme-okta" },
    }),
  };
}

/** A hand-over over `store`, a create that fails with `createFault`, and the library's delete answering `deleteFault`. */
function filled(options: { createFault?: Error; deleteFault?: ConnectError; seen?: Array<string | null> } = {}) {
  const called: string[] = [];
  const store = recordingStore(called);
  const identityAccounts: ComposedIdentityAccounts = {
    store,
    create: () => (options.createFault === undefined ? Promise.resolve(create(IdentityAccountSchema)) : Promise.reject(options.createFault)),
  };
  const inProcessTransport = createRouterTransport((router) => {
    router.service(GrantCommandController, {
      cleanupResourceGrants: () => ({}),
    });
    router.service(IdentityAccountCommandController, {
      delete: (_input, context) => {
        options.seen?.push(context.requestHeader.get(IN_PROCESS_CALLER_HEADER));
        if (options.deleteFault !== undefined) {
          throw options.deleteFault;
        }
        return create(IdentityAccountSchema);
      },
    });
  });
  const accounts = newEnterpriseAccounts();
  accounts.fill({ identityAccounts, inProcessTransport });
  return { accounts, called };
}

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, { metadata: { id: "ida_gone" } });

describe("the server-ee account service's store", () => {
  it("forwards every member to the composition's binding at call time", async () => {
    const { accounts, called } = filled();
    const store = accounts.service.store;
    await store.save(ACCOUNT);
    await store.readForWrite("ida_x");
    await store.swap("ida_x", new Uint8Array(), ACCOUNT);
    await store.deleteById("ida_x");
    await store.findById("ida_x");
    await store.findByIdpId("okta|x");
    await store.findDirectByIdpId("okta|x");
    await store.findDirectByEmail("x@acme.example");
    await store.findByIds(["ida_x"]);
    await store.findByIssuerAndIdpId("fis_acme_okta", "okta|x");
    await store.findByIssuer("fis_acme_okta");
    await store.findByOrg("org_acme");
    expect(called).toEqual([
      "save",
      "readForWrite",
      "swap",
      "deleteById",
      "findById",
      "findByIdpId",
      "findDirectByIdpId",
      "findDirectByEmail",
      "findByIds",
      "findByIssuerAndIdpId",
      "findByIssuer",
      "findByOrg",
    ]);
  });

  it("refuses a call before the composition hands it the account domain", async () => {
    const store = newEnterpriseAccounts().service.store;
    await expect(store.findById("ida_x")).rejects.toThrow(/before the composition handed it the account domain/);
  });
});

describe("the server-ee account service's create", () => {
  it("refuses an account that is not federated, before the library", async () => {
    const { accounts } = filled();
    const request = federatedRequest();
    request.spec.provisioningMode = IdentityAccountProvisioningMode.direct;
    await expect(accounts.service.createAccount(request, "fis_acme")).rejects.toThrow(/only federated accounts/);
  });

  it("refuses a federated account made acting for no provider", async () => {
    const { accounts } = filled();
    await expect(accounts.service.createAccount(federatedRequest())).rejects.toThrow(
      /acting for the federation issuer/,
    );
  });

  it("returns a fault that is not ALREADY_EXISTS as it came", async () => {
    const fault = new ConnectError("store down", Code.Unavailable);
    const { accounts } = filled({ createFault: fault });
    await expect(accounts.service.createAccount(federatedRequest(), "fis_acme")).rejects.toBe(fault);
  });
});

describe("the server-ee account service's delete", () => {
  it("refuses before the composition hands it the account domain", async () => {
    await expect(newEnterpriseAccounts().service.deleteAccount(ACCOUNT, "fis_acme")).rejects.toThrow(
      /before the composition handed it the account domain/,
    );
  });

  it("rethrows a fault of the library's delete that is not NOT_FOUND", async () => {
    const { accounts } = filled({ deleteFault: new ConnectError("store down", Code.Unavailable) });
    const error = await accounts.service.deleteAccount(ACCOUNT, "fis_acme").then(
      () => undefined,
      (e: unknown) => ConnectError.from(e),
    );
    expect(error?.code).toBe(Code.Unavailable);
  });

  it("names nobody on the library's delete when the server acts for no one", async () => {
    const seen: Array<string | null> = [];
    const { accounts } = filled({ seen });
    await accounts.service.deleteAccount(ACCOUNT);
    expect(seen).toEqual([null]);
  });
});
