/**
 * A credential binding for suites that build a controller's or a step's
 * deps by hand and never present a bound credential: it answers every
 * unbound caller as the composed binding does (nothing to say, every
 * organization admitted, every id and entry kept), and refuses to decide
 * for a bound caller, whose answer needs the rows only the real binding
 * reads (`newCredentialBinding`, authorization/credential-binding.ts). A
 * suite that proves binding builds the real one. Enterprise's suites keep
 * the same double (ee/server/src/__test-utils__).
 */
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import { boundOrgOf } from "../../extensions/identity.js";

const BOUND_CALLER_REFUSAL =
  "the unbound credential binding double was asked about a bound caller; build the real binding to prove one";

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
