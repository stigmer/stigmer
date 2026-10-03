// Pins the edition boundary the open-source targets declare: none of them
// claims a surface only the hosted edition serves.
//
// A target's capability flags decide which arms run and which pin a refusal.
// A flag flipped to true on an open-source target would silently skip the
// arm that pins the edition's refusal (the Unimplemented answer a billing or
// proxy RPC gives on the empty composition) and run arms against a surface
// the server does not have. Constructing a target boots nothing — its flags
// are class fields — so this runs in the unit arms with no server.
import { describe, expect, it } from "vitest";

import type { CapabilityFlags } from "../target";
import { LocalTarget } from "../local";
import { LocalExecutionTarget } from "../local-execution";
import { LocalPostgresExecutionTarget, LocalPostgresTarget } from "../local-postgres";

// The surfaces only the hosted edition composes. Each is false on every
// open-source target, by the edition boundary, not as a gap.
const HOSTED_ONLY: ReadonlyArray<keyof CapabilityFlags> = [
  "multiTenant",
  "externalOrgLookup",
  "channelMessaging",
  "orgOAuthAppConfiguration",
  "billingGates",
  "billingLedger",
  "billingPlans",
  "sideChannelProxy",
  "publicLane",
  "directLogin",
  "federatedIdentityAccounts",
  "perResourceGrants",
  "authorizationQueries",
];

describe("the open-source targets' capability flags", () => {
  const targets = [new LocalTarget(), new LocalExecutionTarget(), new LocalPostgresTarget(), new LocalPostgresExecutionTarget()];

  it.each(targets.map((t) => [t.name, t] as const))("%s claims no surface only the hosted edition serves", (_name, target) => {
    const claimed = HOSTED_ONLY.filter((flag) => target.capabilities[flag]);
    expect(claimed).toEqual([]);
  });

  it("the Postgres twins inherit their in-memory targets' flags exactly", () => {
    expect(new LocalPostgresTarget().capabilities).toEqual(new LocalTarget().capabilities);
    expect(new LocalPostgresExecutionTarget().capabilities).toEqual(new LocalExecutionTarget().capabilities);
  });
});
