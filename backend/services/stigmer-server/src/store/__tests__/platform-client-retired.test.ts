/**
 * Pins the driver-neutral half of the platform client kind's removal
 * (../platform-client-retired.ts):
 *   - a grant naming a platform client as resource or principal is found,
 *     and a grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them);
 *   - the step's failure names the row and keeps its cause.
 */
import { describe, expect, it } from "vitest";

import {
  grantNamesRetiredPlatformClient,
  unreadablePlatformClientRowError,
} from "../platform-client-retired.js";
import { grantRow } from "./retired-instance-rows.js";

describe("policyNamesRetiredPlatformClient", () => {
  it.each([
    { principal: "identity_account:ida_1", resource: "platform_client:pcl_1", named: true },
    { principal: "platform_client:pcl_1", resource: "organization:org_1", named: true },
    { principal: "identity_account:ida_1", resource: "organization:org_1", named: false },
    { principal: "identity_account:ida_1", resource: "oauth_app:oap_1", named: false },
  ])("$principal -> $resource: $named", ({ principal, resource, named }) => {
    expect(
      grantNamesRetiredPlatformClient(
        grantRow({ id: "iam_1", principal, relation: "viewer", resource }),
      ),
    ).toBe(named);
  });

  it("throws on bytes that do not decode", () => {
    expect(() => grantNamesRetiredPlatformClient(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("unreadablePlatformClientRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadablePlatformClientRowError("iam_policy", "iam_1", cause);
    expect(error.message).toBe(
      "iam_policy 'iam_1' cannot be read to retire the platform client kind: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
