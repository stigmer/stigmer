/**
 * The self-hosted Enterprise server's account service: the identity unit's
 * account surface (iam/account/port.ts) over the library's own account
 * domain, which the composition hands over at `onComposed`
 * (`ComposedServices.identityAccounts` and the in-process transport). The
 * service is built before the composition and filled from the hand-over,
 * so every call before it is a loud error, never a second implementation.
 *
 * Each operation meets the port's contract (iam/account/port.ts), held by
 * the kit in iam/account/port-contract.ts over this service and every other
 * host's:
 *
 *   createAccount  the library's one create path with its `federated` arm,
 *                  acting for the provider (`serverActingFor`), so the
 *                  account gets the derived id, the chain and the tuple
 *                  lifecycle a person's own sign-in would. The library
 *                  reports a held account as ALREADY_EXISTS; the port's
 *                  callers resolve a lost race by `DuplicateAccountError`,
 *                  so that is what this service throws. Only federated
 *                  accounts are made here: per-organization system
 *                  accounts are another host's lane, which this server
 *                  does not run.
 *   updateAccount  the store binding's `update`, with an audit stamp, as
 *                  every host's own profile write carries. Not the library's
 *                  update RPC: its chain keeps the stored email by design,
 *                  so a person whose email changed at their provider would
 *                  keep the old one forever.
 *   deleteAccount  the grant path's cleanup of every grant row naming the
 *                  account, acting for `actingFor`, so the permission
 *                  history names who caused it; then the library's delete
 *                  RPC over the in-process transport, which runs the
 *                  domain's own chain (the person's My vaults, their keys,
 *                  their row). An account already gone is the delete's
 *                  goal reached.
 */
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { CallOptions } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import type { ComposedServices, IdentityAccountStore } from "@stigmer/server";
import {
  changeThroughGuardedPort,
  DuplicateAccountError,
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
  rethrownStatusError,
  serverActingFor,
} from "@stigmer/server";

import type { IdentityAccountService, NewAccountRequest } from "../iam/account/port.js";
import { newGrantPathClient } from "../iam/grant/grant-path-client.js";
import type { TransportRef } from "../rpc/transport-ref.js";

/** The service, and the hand-over that fills it. */
export interface EnterpriseAccounts {
  readonly service: IdentityAccountService;
  /** Called once from a unit's `onComposed`, before anything can call the service. */
  fill(services: Pick<ComposedServices, "identityAccounts" | "inProcessTransport">): void;
}

const NOT_FILLED = "the Enterprise account service was called before the composition handed it the account domain";

export function newEnterpriseAccounts(): EnterpriseAccounts {
  let accounts: ComposedServices["identityAccounts"] | undefined;
  const transportRef: TransportRef = {};
  const grants = newGrantPathClient(transportRef);

  function domain(): ComposedServices["identityAccounts"] {
    if (accounts === undefined) {
      throw new Error(NOT_FILLED);
    }
    return accounts;
  }

  // The store a lane holds from the moment the unit is built, forwarding
  // each call to the hand-over's binding at call time: a host's lanes take
  // `store` when they are constructed, before the composition fills it.
  // Every member is listed, so a member the library adds fails this compile.
  type Store = IdentityAccountStore;
  const store: Store = {
    save: async (...args: Parameters<Store["save"]>) => domain().store.save(...args),
    readForWrite: async (...args: Parameters<Store["readForWrite"]>) => domain().store.readForWrite(...args),
    swap: async (...args: Parameters<Store["swap"]>) => domain().store.swap(...args),
    deleteById: async (...args: Parameters<Store["deleteById"]>) => domain().store.deleteById(...args),
    findById: async (...args: Parameters<Store["findById"]>) => domain().store.findById(...args),
    findByIdpId: async (...args: Parameters<Store["findByIdpId"]>) => domain().store.findByIdpId(...args),
    findDirectByIdpId: async (...args: Parameters<Store["findDirectByIdpId"]>) =>
      domain().store.findDirectByIdpId(...args),
    findDirectByEmail: async (...args: Parameters<Store["findDirectByEmail"]>) =>
      domain().store.findDirectByEmail(...args),
    findByIds: async (...args: Parameters<Store["findByIds"]>) => domain().store.findByIds(...args),
    findByIssuerAndIdpId: async (...args: Parameters<Store["findByIssuerAndIdpId"]>) =>
      domain().store.findByIssuerAndIdpId(...args),
    findByIssuer: async (...args: Parameters<Store["findByIssuer"]>) => domain().store.findByIssuer(...args),
    findByOrg: async (...args: Parameters<Store["findByOrg"]>) => domain().store.findByOrg(...args),
  };

  const service: IdentityAccountService = {
    store,

    async createAccount(request: NewAccountRequest, actingFor?: string): Promise<IdentityAccount> {
      const provider = request.spec.federationIssuerRef;
      if (request.spec.provisioningMode !== IdentityAccountProvisioningMode.federated || provider === undefined) {
        throw new Error("this server makes only federated accounts: a provider vouches for every person it signs in");
      }
      if (actingFor === undefined || actingFor === "") {
        throw new Error("a federated account is made acting for the federation issuer that vouches for it");
      }
      try {
        return await domain().create(
          {
            name: request.name ?? request.spec.email,
            spec: request.spec,
            provisioning: { mode: "federated", provider: { org: provider.org, id: provider.id } },
          },
          serverActingFor(actingFor),
        );
      } catch (error) {
        if (ConnectError.from(error).code === Code.AlreadyExists) {
          throw new DuplicateAccountError(
            `a federated account for '${request.spec.idpId}' through '${provider.org}/${provider.id}' already exists`,
            { cause: error },
          );
        }
        throw error;
      }
    },

    updateAccount(
      id: string,
      change: (account: IdentityAccount) => void,
    ): Promise<IdentityAccount | undefined> {
      return changeThroughGuardedPort(store, ApiResourceKind.identity_account, id, (account) => {
        change(account);
        const specAudit = account.status?.audit?.specAudit;
        if (specAudit !== undefined) {
          specAudit.updatedAt = create(TimestampSchema, {
            seconds: BigInt(Math.floor(Date.now() / 1000)),
          });
        }
      });
    },

    async deleteAccount(account: IdentityAccount, actingFor?: string): Promise<void> {
      const accountId = account.metadata?.id ?? "";
      const transport = transportRef.transport;
      if (transport === undefined) {
        throw new Error(NOT_FILLED);
      }
      await grants.cleanupResourceGrants(
        create(ApiResourceRefSchema, { kind: "identity_account", id: accountId }),
        actingFor,
      );
      try {
        await createClient(IdentityAccountCommandController, transport).delete(
          { value: accountId },
          optionsFor(actingFor),
        );
      } catch (error) {
        const status = ConnectError.from(error);
        if (status.code !== Code.NotFound) {
          throw rethrownStatusError(status);
        }
      }
    },
  };

  return {
    service,
    fill(services): void {
      accounts = services.identityAccounts;
      transportRef.transport = services.inProcessTransport;
    },
  };
}

/** The call options naming whom the server acts for; none when it acts as itself. */
function optionsFor(actingFor: string | undefined): CallOptions | undefined {
  if (actingFor === undefined || actingFor === "") {
    return undefined;
  }
  return {
    headers: { [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(serverActingFor(actingFor)) },
  };
}
