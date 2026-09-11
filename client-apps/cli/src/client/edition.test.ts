// Unit tests for the CLI's edition question (client/edition.ts; 20260911.11
// A3): "does the connected server serve this kind?" answered from the
// server's reported edition and the kind's tier through @stigmer/sdk's one
// converter and rank comparison — never from the backend's config type.
// The console asks the same question through useResourceAvailable, so one
// user gets one answer on both surfaces.

import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { resourceServedOn } from "./edition.js";

describe("resourceServedOn", () => {
  it("identity accounts are served by every edition once the kind is open_source", () => {
    expect(
      resourceServedOn(ApiResourceKind.identity_account, ServerEdition.oss),
    ).toBe(true);
    expect(
      resourceServedOn(
        ApiResourceKind.identity_account,
        ServerEdition.enterprise,
      ),
    ).toBe(true);
    expect(
      resourceServedOn(ApiResourceKind.identity_account, ServerEdition.cloud),
    ).toBe(true);
  });

  it("reads the tier, not a constant — a cloud_only kind is not served by an oss server", () => {
    expect(
      resourceServedOn(ApiResourceKind.platform_client, ServerEdition.oss),
    ).toBe(false);
    expect(
      resourceServedOn(ApiResourceKind.platform_client, ServerEdition.cloud),
    ).toBe(true);
  });

  it("treats an unspecified edition as cloud — nothing hidden on a broken or newer server", () => {
    expect(
      resourceServedOn(
        ApiResourceKind.identity_account,
        ServerEdition.server_edition_unspecified,
      ),
    ).toBe(true);
  });
});
