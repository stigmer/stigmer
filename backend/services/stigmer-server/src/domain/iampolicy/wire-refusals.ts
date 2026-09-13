/**
 * The IamPolicy domain's wire refusals (20260913.01; slice 2 ruling
 * Q-S2-1, slice 5 ruling Q-S5-2): the ONE place a kind string that came
 * off the wire, or a whole policy triple, is turned into INVALID_ARGUMENT
 * with the domain's byte-pinned copy (constants.ts). Three callers share
 * it so the rule cannot drift between them — the grant path (before any
 * read, write or lifecycle hook), the create chain's ValidateGrantableRole
 * step (before its role arms, so an unknown kind is never answered with a
 * role sentence) and the query controller (checkMyPermission's resource,
 * checkAuthorization's policy, the two listings' kind strings, the three
 * row reads' refs).
 *
 * Why the match is exact (the `kindByEnumName` doctrine,
 * pipeline/apiresource-meta.ts): an `ApiResourceRef.kind` is the enum
 * MEMBER name and the derived policy id hashes the spec's text (Q-OR-9), so
 * a lenient match would let "Organization" and "organization" mint two
 * rows for one grant. Where the refusal runs (Q-S6-1, 2026-09-14): the
 * controller calls it BEFORE position 1 on every lane, so no Authorizer in
 * any edition is ever asked about a kind that is not a kind — a kind
 * string that names no kind names no authorization target (the cloud's
 * handlers kept this order; the resolver's unknown-kind deny stays as the
 * backstop for a stored row on `get`). The grant path and the
 * ValidateGrantableRole step keep their own calls for the callers that
 * reach them without the controller (the lifecycle, the membership rules,
 * the unit suites), so a garbage row never enters the store from any door.
 *
 * A spec missing either reference is a plain Error, not a refusal: the
 * protovalidate boundary marks both `required`, so absence is a contract
 * bug in a caller that bypassed it, never a client's mistake.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import { kindByEnumName } from "../../pipeline/apiresource-meta.js";
import {
  malformedTripleField,
  malformedTripleMessage,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "./constants.js";

/** A triple the wire may say: both refs present, both kinds resolved. */
export interface AdmittedTriple {
  readonly principal: ApiResourceRef;
  readonly resource: ApiResourceRef;
  readonly principalKind: ApiResourceKind;
  readonly resourceKind: ApiResourceKind;
}

/** The kind a `resource.kind` string names, or INVALID_ARGUMENT with the cloud's sentence. */
export function requireKnownResourceKind(kind: string): ApiResourceKind {
  const resolved = kindByEnumName(kind);
  if (resolved === ApiResourceKind.api_resource_kind_unknown) {
    throw new ConnectError(
      unknownResourceKindMessage(kind),
      Code.InvalidArgument,
    );
  }
  return resolved;
}

/** The kind a `principal.kind` string names, or INVALID_ARGUMENT with the principal sentence. */
export function requireKnownPrincipalKind(kind: string): ApiResourceKind {
  const resolved = kindByEnumName(kind);
  if (resolved === ApiResourceKind.api_resource_kind_unknown) {
    throw new ConnectError(
      unknownPrincipalKindMessage(kind),
      Code.InvalidArgument,
    );
  }
  return resolved;
}

/**
 * The whole triple, in the order the cloud refused it: no delimiter in any
 * field (the canonical text would be ambiguous, Q-S2-1), then the resource
 * kind, then the principal kind.
 */
export function requireWellFormedTriple(spec: IamPolicySpec): AdmittedTriple {
  const { principal, resource } = refsOf(spec);
  const malformed = malformedTripleField(spec);
  if (malformed !== undefined) {
    throw new ConnectError(
      malformedTripleMessage(malformed),
      Code.InvalidArgument,
    );
  }
  return {
    principal,
    resource,
    resourceKind: requireKnownResourceKind(resource.kind),
    principalKind: requireKnownPrincipalKind(principal.kind),
  };
}

/** Both refs, present — absence is a caller that bypassed the boundary, not wire input. */
export function refsOf(spec: IamPolicySpec): {
  principal: ApiResourceRef;
  resource: ApiResourceRef;
} {
  if (spec.principal === undefined || spec.resource === undefined) {
    throw new Error("policy spec must carry principal and resource");
  }
  return { principal: spec.principal, resource: spec.resource };
}
