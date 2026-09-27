/**
 * The one rule for "this PlatformClient has expired", shared by the list's
 * expiry badge, the detail view and the rotate confirmation so the three
 * never disagree. It is the server's rule, the one the mint refuses by: an
 * expiry is set, `never_expires` is off, and the expiry has passed.
 *
 * Package-internal on purpose: every name the barrel exports is a public
 * API contract, and no platform builder has asked for this one.
 */
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

/** Whether the client's secret no longer mints (its expiry has passed). */
export function isPlatformClientExpired(
  spec: PlatformClient["spec"],
  now: Date = new Date(),
): boolean {
  if (spec === undefined || spec.neverExpires || spec.expiresAt === undefined) {
    return false;
  }
  return timestampDate(spec.expiresAt).getTime() < now.getTime();
}
