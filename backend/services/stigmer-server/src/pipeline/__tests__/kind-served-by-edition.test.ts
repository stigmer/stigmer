/**
 * Pins `tierServedByEdition` and `kindServedByEdition`
 * (pipeline/apiresource-meta.ts), the server's twin of the SDK's tier-rank
 * functions (sdk/typescript/src/resource-availability.ts: editions
 * oss < enterprise < cloud; a tier admits its own edition and every edition
 * above it; the enum NUMBERS are wire identifiers, never ranks —
 * `enterprise` sits at 3 in both enums and ranks second). T01_1_review.md
 * Q-OR-8 and claim check C5: the two implementations must agree on the
 * whole matrix, because the console reads the SDK's answer to decide what
 * to SHOW and `checkMyPermission` reads the server's to decide what is
 * HELD; a disagreement is a surface that appears and then fails, the
 * Q-EC-2b class.
 *
 * The matrix is spelled out rather than computed, so a change on either
 * side is a visible diff here and the SDK's own test remains the SDK's.
 */
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  kindServedByEdition,
  tierServedByEdition,
} from "../apiresource-meta.js";

const EDITIONS = [
  ServerEdition.oss,
  ServerEdition.enterprise,
  ServerEdition.cloud,
] as const;

/** tier → the editions that serve it, in the SDK's order. */
const MATRIX: ReadonlyArray<readonly [ResourceTier, readonly boolean[]]> = [
  [ResourceTier.open_source, [true, true, true]],
  [ResourceTier.enterprise, [false, true, true]],
  [ResourceTier.cloud_only, [false, false, true]],
  // A kind whose proto forgot the field is treated as core, as the SDK
  // treats it: hiding a kind is the worse failure for a client, and holding
  // a permission on a kind every edition serves is the truthful answer.
  [ResourceTier.resource_tier_unspecified, [true, true, true]],
];

describe("tierServedByEdition — the SDK's rank table, spelled out", () => {
  for (const [tier, served] of MATRIX) {
    it(`${ResourceTier[tier]} is served by [oss, enterprise, cloud] = [${served.join(", ")}]`, () => {
      expect(
        EDITIONS.map((edition) => tierServedByEdition(tier, edition)),
      ).toEqual(served);
    });
  }

  it("an edition the server does not know serves everything — an older server hides nothing, the SDK's own fallback", () => {
    for (const [tier] of MATRIX) {
      expect(
        tierServedByEdition(tier, ServerEdition.server_edition_unspecified),
      ).toBe(true);
    }
  });
});

describe("kindServedByEdition — the kind's tier through the same table", () => {
  it("reads the tier from kind_meta: agent everywhere, invitation from enterprise up, api_resource_version on cloud only", () => {
    expect(
      EDITIONS.map((edition) =>
        kindServedByEdition(ApiResourceKind.agent, edition),
      ),
    ).toEqual([true, true, true]);
    expect(
      EDITIONS.map((edition) =>
        kindServedByEdition(ApiResourceKind.invitation, edition),
      ),
    ).toEqual([false, true, true]);
    expect(
      EDITIONS.map((edition) =>
        kindServedByEdition(ApiResourceKind.api_resource_version, edition),
      ),
    ).toEqual([false, false, true]);
  });

  it("platform is enterprise-tiered, so the operator seat's permissions are never held on open source (the settings-navigation arm)", () => {
    expect(
      kindServedByEdition(ApiResourceKind.platform, ServerEdition.oss),
    ).toBe(false);
    expect(
      kindServedByEdition(ApiResourceKind.platform, ServerEdition.enterprise),
    ).toBe(true);
  });

  it("iam_policy is served by every edition once this entry flips it", () => {
    expect(
      kindServedByEdition(ApiResourceKind.iam_policy, ServerEdition.oss),
    ).toBe(true);
  });

  it("the unknown kind is a programming error, not an answer", () => {
    expect(() =>
      kindServedByEdition(
        ApiResourceKind.api_resource_kind_unknown,
        ServerEdition.cloud,
      ),
    ).toThrow();
  });
});
