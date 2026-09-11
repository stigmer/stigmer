/**
 * Pins the edition vocabulary (`resource-availability.ts`): the one
 * edition-to-mode converter, the rank comparison behind
 * `isResourceAvailable`, and the two properties the DDs assumed and this
 * module has to make true —
 *
 *   - ranks, never wire numbers: `enterprise = 3` sits ABOVE `cloud = 2`
 *     and `cloud_only = 2` on the wire, so a comparison on enum values
 *     would say an Enterprise-tier kind is not served by a Cloud server;
 *   - forward compatibility: an edition value this SDK does not know
 *     (a newer server) maps to `"cloud"` instead of throwing, so an older
 *     console never breaks against a newer server.
 *
 * The kinds named here are chosen one per tier; re-tiering any of them is
 * a contract change and must touch this file (editions program, DD-001).
 */
import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  deploymentModeOf,
  isResourceAvailable,
  type DeploymentMode,
} from "../resource-availability";

const MODES: readonly DeploymentMode[] = ["local", "enterprise", "cloud"];

describe("deploymentModeOf — the one edition-to-mode converter", () => {
  it("maps each known edition to its mode", () => {
    expect(deploymentModeOf(ServerEdition.oss)).toBe("local");
    expect(deploymentModeOf(ServerEdition.enterprise)).toBe("enterprise");
    expect(deploymentModeOf(ServerEdition.cloud)).toBe("cloud");
  });

  it("maps unspecified to cloud — the documented safe default (nothing hidden on a broken server)", () => {
    expect(deploymentModeOf(ServerEdition.server_edition_unspecified)).toBe(
      "cloud",
    );
  });

  it("maps an edition this SDK does not know to cloud instead of throwing — older client, newer server", () => {
    // A future fourth edition arrives off the wire as a number the enum
    // type does not name. The cast is the test's point.
    expect(deploymentModeOf(99 as ServerEdition)).toBe("cloud");
  });
});

describe("isResourceAvailable — a tier is a minimum edition", () => {
  it("open_source-tier kinds are available in every mode", () => {
    for (const mode of MODES) {
      expect(isResourceAvailable(ApiResourceKind.agent, mode), mode).toBe(true);
    }
  });

  it("enterprise-tier kinds are available in enterprise and cloud, not local", () => {
    expect(isResourceAvailable(ApiResourceKind.iam_policy, "local")).toBe(
      false,
    );
    expect(isResourceAvailable(ApiResourceKind.iam_policy, "enterprise")).toBe(
      true,
    );
    // The inversion case: enterprise = 3 > cloud = 2 on the wire. A
    // wire-number comparison fails exactly here.
    expect(isResourceAvailable(ApiResourceKind.iam_policy, "cloud")).toBe(true);
  });

  it("cloud_only-tier kinds are available in cloud only", () => {
    expect(
      isResourceAvailable(ApiResourceKind.api_resource_version, "local"),
    ).toBe(false);
    expect(
      isResourceAvailable(ApiResourceKind.api_resource_version, "enterprise"),
    ).toBe(false);
    expect(
      isResourceAvailable(ApiResourceKind.api_resource_version, "cloud"),
    ).toBe(true);
  });

  it("the kinds this entry re-tiers read as their new tier", () => {
    // oauth_app: served by the OSS server; the cloud_only tier was drift.
    expect(isResourceAvailable(ApiResourceKind.oauth_app, "local")).toBe(true);
    // platform: the operator seat a self-hosting Enterprise company owns.
    expect(isResourceAvailable(ApiResourceKind.platform, "local")).toBe(false);
    expect(isResourceAvailable(ApiResourceKind.platform, "enterprise")).toBe(
      true,
    );
    // identity_account: flips to open_source in P1's serving PR, not here.
    expect(isResourceAvailable(ApiResourceKind.identity_account, "local")).toBe(
      false,
    );
    // agent_share and channel_app: served by OSS; they never moved.
    expect(isResourceAvailable(ApiResourceKind.agent_share, "local")).toBe(
      true,
    );
    expect(isResourceAvailable(ApiResourceKind.channel_app, "local")).toBe(
      true,
    );
  });

  it("refuses a kind with no tier — a programming error, never silently available", () => {
    expect(() =>
      isResourceAvailable(ApiResourceKind.api_resource_kind_unknown, "cloud"),
    ).toThrow(/no tier/);
  });
});
