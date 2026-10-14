/**
 * The composition's client of the OSS IamPolicy grant path.
 * `@stigmer/server`'s grant path is the ONE code that writes or deletes a
 * policy row in every edition, and it is deliberately not exported: a
 * composition reaches it as in-process RPCs, so every write — the
 * structural rows the tuple lifecycle seeds, the JIT and invitation role
 * grants, the cleanups on delete — passes the same router, the same
 * system-RPC guard and the same chain a wire caller's would. This module is
 * the one place a host builds that client; every lane and the lifecycle
 * driver hold it by this interface and nothing else.
 *
 * The methods carry the RPC names verbatim, so a reader at a call site sees
 * which OSS lane the call enters and which guard it meets:
 *   - `bootstrapPolicy`: the structural lane — any relation on any kind, no
 *     role check; admitted for in-process, `internal` and `machine` callers
 *     only (the OSS controller's admission rule). Every row the lifecycle
 *     seeds, the guest and self-owner
 *     rows, and a child organization's `parent_org` and `child_org` edges.
 *     One principal is
 *     refused here, before any RPC: a TEAM. A grant to a team rides
 *     `IamPolicy.create` so the team grant gate on
 *     `iam-policy-create:pre-side-effect-gate` checks the team belongs to
 *     the resource's organization; the structural lane runs no gate, so a
 *     team principal written through it would reach across organizations
 *     unchecked. A team as the RESOURCE stays the structural lane's (its
 *     organization link), since that is the row the lifecycle owns.
 *   - `create`: the user lane — `ValidateGrantableRole` runs (a grantable
 *     role, on a kind in the grant scope, to a PERSON). The JIT lanes and
 *     the invitation redeem use it, so a misconfigured auto-grant role is
 *     refused the way a console grant would be.
 *   - `delete`: revoke one triple; absent is the default instance.
 *   - `cleanupResourcePolicies`, `bootstrapRevokeOrgAccess`: the two
 *     system revoke lanes.
 *
 * Who a call names. Without `actingFor` no caller header rides the call:
 * the OSS in-process interceptor mints `callerClass: "internal"`, the
 * server acting as itself, which the `Authorize` step honours by skipping.
 * With `actingFor`, the call carries `serverActingFor(id)`: still the
 * `internal` class, so the same admission and the same skip, but the row's
 * audit stamp and the permission history name that principal as the one
 * the server acted for (the person whose act caused the write, or the
 * identity provider that asserted it). A lane passes it whenever a
 * principal is behind the write; the boot repairs, which act for no one,
 * do not. The user-facing `revokeOrgAccess` is never called here — the
 * composition acts for a person, never as one. The transport is the
 * composed server's, wired post-compose (`TransportRef`, as the invitation
 * preview holds it), so the client is built lazily and a call
 * before the wiring is a loud INTERNAL.
 *
 * A refusal from the controller is rethrown as a FRESH ConnectError with
 * the same code and copy, by the library's `rethrownStatusError`: a
 * ConnectError received from a client call carries the inner response's
 * transport metadata, and rethrowing that object through a serving handler
 * corrupts the outer HTTP/2 framing (the caller sees NGHTTP2_PROTOCOL_ERROR
 * instead of the gRPC status).
 */
import { createClient } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import type { CallOptions, Client, Transport } from "@connectrpc/connect";
import {
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
  rethrownStatusError,
  serverActingFor,
} from "@stigmer/server";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { TransportRef } from "../../rpc/transport-ref.js";

/**
 * Every method's last argument: the principal the server acts for, whose
 * id the row's stamp and the permission history record. Absent, the server
 * acts as itself.
 */
export type ActingFor = string | undefined;

export interface IamPolicyGrantPathClient {
  /** The structural lane: any relation on any kind, admitted for the server acting as itself. */
  bootstrapPolicy(spec: IamPolicySpec, actingFor?: ActingFor): Promise<IamPolicy>;
  /** The user lane: a grantable role on an in-scope kind, to a person. */
  create(spec: IamPolicySpec, actingFor?: ActingFor): Promise<IamPolicy>;
  /** Revoke one triple; the default instance when there was no row. */
  delete(spec: IamPolicySpec, actingFor?: ActingFor): Promise<IamPolicy>;
  /** Every row naming the ref as resource or as principal dies. */
  cleanupResourcePolicies(ref: ApiResourceRef, actingFor?: ActingFor): Promise<void>;
  /** Every relation the account holds directly on the organization dies. */
  bootstrapRevokeOrgAccess(
    identityAccountId: string,
    organizationId: string,
    actingFor?: ActingFor,
  ): Promise<void>;
}

const NOT_WIRED =
  "iam policy grant path used before the in-process transport was wired";

/** The team's kind as an `ApiResourceRef.kind` spells it. */
const TEAM_KIND = ApiResourceKind[ApiResourceKind.team];

const TEAM_PRINCIPAL_REFUSED =
  "a grant to a team is made through IamPolicy.create, never the structural lane";

export function newIamPolicyGrantPathClient(
  transportRef: TransportRef,
): IamPolicyGrantPathClient {
  let commands: Client<typeof IamPolicyCommandController> | undefined;

  function client(): Client<typeof IamPolicyCommandController> {
    const transport: Transport | undefined = transportRef.transport;
    if (transport === undefined) {
      throw new ConnectError(NOT_WIRED, Code.Internal);
    }
    return (commands ??= createClient(IamPolicyCommandController, transport));
  }

  async function call<T>(
    rpc: (commands: Client<typeof IamPolicyCommandController>) => Promise<T>,
  ): Promise<T> {
    try {
      return await rpc(client());
    } catch (error) {
      throw rethrownStatusError(ConnectError.from(error));
    }
  }

  return {
    bootstrapPolicy: (spec, actingFor) => {
      if (spec.principal?.kind === TEAM_KIND) {
        return Promise.reject(new ConnectError(TEAM_PRINCIPAL_REFUSED, Code.Internal));
      }
      return call((c) => c.bootstrapPolicy(spec, optionsFor(actingFor)));
    },
    create: (spec, actingFor) =>
      call((c) => c.create(spec, optionsFor(actingFor))),
    delete: (spec, actingFor) =>
      call((c) => c.delete(spec, optionsFor(actingFor))),
    cleanupResourcePolicies: async (ref, actingFor) => {
      await call((c) => c.cleanupResourcePolicies(ref, optionsFor(actingFor)));
    },
    bootstrapRevokeOrgAccess: async (
      identityAccountId,
      organizationId,
      actingFor,
    ) => {
      await call((c) =>
        c.bootstrapRevokeOrgAccess(
          { identityAccountId, org: organizationId },
          optionsFor(actingFor),
        ),
      );
    },
  };
}

/** The call options naming whom the server acts for; none when it acts as itself. */
function optionsFor(actingFor: ActingFor): CallOptions | undefined {
  if (actingFor === undefined || actingFor === "") {
    return undefined;
  }
  return {
    headers: {
      [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(
        serverActingFor(actingFor),
      ),
    },
  };
}
