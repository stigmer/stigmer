/**
 * Pins the system-managed PlatformClient builder, the one place an edition
 * gets the row it keeps for the platform's own tokens:
 *   - the row is the kind's own shape: a `pcl_` id, the owning org, the
 *     reserved slug, the kind's default visibility, and the reserved
 *     `stigmer.ai/system-managed` label the mutation chains refuse;
 *   - it satisfies the contract's protovalidate rules, so a driver that
 *     validates on write, or a later chain that reads it, sees a valid row;
 *   - its credentials are real and fresh per row (a `client_id` a unique
 *     index can hold), while no plaintext secret leaves the builder;
 *   - its audit names no actor and both slots carry the one creation
 *     instant;
 *   - a slug that is not reserved, or an empty organization, is refused
 *     loudly, so a system-managed client can never sit where a user's can.
 */
import { toJsonString } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { validator } from "../../../pipeline/steps/validation.js";
import { SYSTEM_SHARE_CLIENT_SLUG } from "../constants.js";
import { newSystemManagedPlatformClient } from "../system-managed.js";

const NOW = new Date("2026-09-23T10:00:00Z");

function build() {
  return newSystemManagedPlatformClient({
    org: "acme",
    slug: SYSTEM_SHARE_CLIENT_SLUG,
    name: "System Share Client",
    now: NOW,
  });
}

describe("newSystemManagedPlatformClient", () => {
  it("builds the kind's own shape under the reserved slug, labelled system-managed", () => {
    const client = build();
    expect(client.apiVersion).toBe("iam.stigmer.ai/v1");
    expect(client.kind).toBe("PlatformClient");
    expect(client.metadata?.id).toMatch(/^pcl_[0-9a-z]{26}$/);
    expect(client.metadata).toMatchObject({
      org: "acme",
      slug: "system-share-client",
      name: "System Share Client",
      labels: { "stigmer.ai/system-managed": "true" },
    });
    expect(client.metadata?.visibility).not.toBe(
      ApiResourceVisibility.api_resource_visibility_unspecified,
    );
    expect(client.spec?.autoProvisionAccounts).toBe(false);
    expect(client.spec?.autoGrantOnOrg).toBe(false);
    expect(client.spec?.allowedOrigins).toEqual([]);
  });

  it("satisfies the contract's rules", () => {
    expect(validator().validate(PlatformClientSchema, build()).kind).toBe(
      "valid",
    );
  });

  it("carries real, fresh credentials and no plaintext secret", () => {
    const first = build();
    const second = build();
    expect(first.spec?.clientId).toMatch(/^stgm_cid_[A-Za-z0-9_-]{43}$/);
    expect(first.spec?.clientSecretHash).toHaveLength(43);
    expect(first.spec?.secretFingerprint).toHaveLength(6);
    expect(second.spec?.clientId).not.toBe(first.spec?.clientId);
    expect(second.metadata?.id).not.toBe(first.metadata?.id);
    expect(toJsonString(PlatformClientSchema, first)).not.toContain("stgm_cs_");
  });

  it("stamps both audit slots with the creation instant and no actor", () => {
    const audit = build().status?.audit;
    for (const slot of [audit?.specAudit, audit?.statusAudit]) {
      expect(slot?.event).toBe("created");
      expect(slot?.createdBy).toBeUndefined();
      expect(slot?.createdAt && timestampDate(slot.createdAt)).toEqual(NOW);
      expect(slot?.updatedAt && timestampDate(slot.updatedAt)).toEqual(NOW);
    }
  });

  it("refuses a slug that is not reserved, and an empty organization", () => {
    expect(() =>
      newSystemManagedPlatformClient({
        org: "acme",
        slug: "dashboard",
        name: "Dashboard",
      }),
    ).toThrow(/not a reserved platform-client slug/);
    expect(() =>
      newSystemManagedPlatformClient({
        org: "",
        slug: SYSTEM_SHARE_CLIENT_SLUG,
        name: "System Share Client",
      }),
    ).toThrow(/needs an organization/);
  });
});
