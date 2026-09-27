/**
 * Pins the one expiry rule the platform-client panels share (#1254): it is
 * the server's rule, so a client reads expired exactly when the mint would
 * refuse it — an expiry set, never_expires off, and the expiry passed.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";

import { isPlatformClientExpired } from "../expiry";

const NOW = new Date("2026-09-28T12:00:00Z");
const before = timestampFromDate(new Date(NOW.getTime() - 1000));
const after = timestampFromDate(new Date(NOW.getTime() + 1000));

describe("isPlatformClientExpired", () => {
  it("is true only for a passed expiry with never_expires off", () => {
    expect(
      isPlatformClientExpired(create(PlatformClientSpecSchema, { expiresAt: before }), NOW),
    ).toBe(true);
    expect(
      isPlatformClientExpired(create(PlatformClientSpecSchema, { expiresAt: after }), NOW),
    ).toBe(false);
  });

  it("never_expires, an unset expiry and a missing spec never read expired", () => {
    expect(
      isPlatformClientExpired(
        create(PlatformClientSpecSchema, { expiresAt: before, neverExpires: true }),
        NOW,
      ),
    ).toBe(false);
    expect(isPlatformClientExpired(create(PlatformClientSpecSchema, {}), NOW)).toBe(false);
    expect(isPlatformClientExpired(undefined, NOW)).toBe(false);
  });
});
