/**
 * Pins wire-refusals.ts (20260913.01 slice 5, Q-S5-2): the one place a
 * kind string that came off the wire, or a whole triple, is turned into
 * INVALID_ARGUMENT with the domain's byte-pinned copy. Three callers share
 * it — the grant path, the ValidateGrantableRole step and the fourteen
 * RPCs' controller — so the table is proven once here; grant-path.test.ts
 * keeps its own arms and passes through the moved functions unchanged.
 *
 * Exactness is contract (Q-OR-9): the derived policy id hashes the spec's
 * text, so a lenient match would let two spellings of one kind mint two
 * rows for one grant.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  malformedTripleMessage,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import {
  requireKnownPrincipalKind,
  requireKnownResourceKind,
  requireWellFormedTriple,
} from "../wire-refusals.js";
import { orgRole, triple } from "./support.js";

function refusal(run: () => unknown): ConnectError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("requireKnownResourceKind / requireKnownPrincipalKind", () => {
  it("resolve exact enum member names", () => {
    expect(requireKnownResourceKind("organization")).toBe(
      ApiResourceKind.organization,
    );
    expect(requireKnownPrincipalKind("identity_account")).toBe(
      ApiResourceKind.identity_account,
    );
  });

  for (const garbage of [
    "Organization",
    "ORGANIZATION",
    "",
    "api_resource_kind_unknown",
    "constructor",
    "15",
  ]) {
    it(`refuse ${JSON.stringify(garbage)} as a resource kind with the cloud's copy`, () => {
      const error = refusal(() => requireKnownResourceKind(garbage));
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(unknownResourceKindMessage(garbage));
    });
  }

  it("refuse an unknown principal kind with the principal sentence", () => {
    const error = refusal(() => requireKnownPrincipalKind("team-ish"));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(unknownPrincipalKindMessage("team-ish"));
  });
});

describe("requireWellFormedTriple", () => {
  it("answers both refs and both resolved kinds for a well-formed triple", () => {
    const admitted = requireWellFormedTriple(orgRole("ida_a", "admin", "acme"));
    expect(admitted.resourceKind).toBe(ApiResourceKind.organization);
    expect(admitted.principalKind).toBe(ApiResourceKind.identity_account);
    expect(admitted.resource.id).toBe("acme");
    expect(admitted.principal.id).toBe("ida_a");
  });

  it("refuses a delimiter in any field BEFORE either kind is resolved (Q-S2-1)", () => {
    const error = refusal(() =>
      requireWellFormedTriple(
        triple({ kind: "garbage", id: "a#b" }, "viewer", {
          kind: "garbage",
          id: "x",
        }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(malformedTripleMessage("principal.id"));
  });

  it("refuses the resource kind before the principal kind — the cloud's order", () => {
    const error = refusal(() =>
      requireWellFormedTriple(
        triple({ kind: "nope", id: "a" }, "viewer", {
          kind: "also-nope",
          id: "x",
        }),
      ),
    );
    expect(error.rawMessage).toBe(unknownResourceKindMessage("also-nope"));
  });

  it("refuses an unknown principal kind once the resource kind is known", () => {
    const error = refusal(() =>
      requireWellFormedTriple(
        triple({ kind: "nope", id: "a" }, "viewer", {
          kind: "organization",
          id: "acme",
        }),
      ),
    );
    expect(error.rawMessage).toBe(unknownPrincipalKindMessage("nope"));
  });
});
