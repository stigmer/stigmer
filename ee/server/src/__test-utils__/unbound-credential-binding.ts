/**
 * A credential binding for suites that build a unit's composed services by
 * hand and never present a bound credential: it answers every unbound
 * caller as the library's binding does (nothing to say, every organization
 * admitted, every id and entry kept), and refuses to decide for a bound
 * caller, whose answer needs the rows only the library's own binding reads.
 * A suite that proves binding composes a real server instead.
 *
 * Edition-neutral by what it imports (the library's barrel only).
 */
import type { CredentialBinding } from "@stigmer/server";
import { boundOrgOf } from "@stigmer/server";

const BOUND_CALLER_REFUSAL =
  "the unbound credential binding double was asked about a bound caller; compose a server to prove a binding";

export const UNBOUND_CREDENTIAL_BINDING: CredentialBinding = {
  verdict: (caller) =>
    boundOrgOf(caller) === undefined
      ? Promise.resolve("unbound")
      : Promise.reject(new Error(BOUND_CALLER_REFUSAL)),
  admitsOrganization: (caller) =>
    boundOrgOf(caller) === undefined
      ? Promise.resolve(true)
      : Promise.reject(new Error(BOUND_CALLER_REFUSAL)),
  keepsEntry: (caller) =>
    boundOrgOf(caller) === undefined
      ? Promise.resolve(true)
      : Promise.reject(new Error(BOUND_CALLER_REFUSAL)),
  narrowIds: (caller, _kind, ids) =>
    boundOrgOf(caller) === undefined
      ? Promise.resolve(ids)
      : Promise.reject(new Error(BOUND_CALLER_REFUSAL)),
};
