// Pins the edition boundary the open-source targets declare: none of them
// claims a surface only an edition above open source serves.
//
// A target's capability flags decide which arms run and which pin a refusal.
// A flag flipped to true on an open-source target would silently skip the
// arm that pins the edition's refusal (the Unimplemented answer a billing or
// proxy RPC gives on the empty composition) and run arms against a surface
// the server does not have. Constructing a target boots nothing — its flags
// are class fields — so this runs in the unit arms with no server. The one
// flag every open-source target sets true, because the edition lacks a gate,
// is pinned beside them: a Cursor run is admitted, since no provider key is
// asked for.
import { describe, expect, it } from "vitest";

import type { CapabilityFlags } from "../target";
import { LocalTarget } from "../local";
import { LocalExecutionTarget } from "../local-execution";
import { LocalPostgresExecutionTarget, LocalPostgresTarget } from "../local-postgres";

// The surfaces only an edition above open source composes: the Cloud's own,
// and the ones Enterprise shares with it (many organizations, federation,
// per-resource grants). Each is false on every open-source target, by the
// edition boundary, not as a gap. Teams are an enum, pinned beside them.
const ABOVE_OPEN_SOURCE: ReadonlyArray<keyof CapabilityFlags> = [
  "multiTenant",
  "channelMessaging",
  "billingGates",
  "billingEngine",
  "billingPlans",
  "sideChannelProxy",
  "publicLane",
  "directLogin",
  "federatedIdentityAccounts",
  "invitations",
  "federationIssuers",
  "perResourceGrants",
  "authorizationQueries",
  "guestMinting",
  "cloudTargetRefusesLocalPrograms",
  "runModelCallsMetered",
];

describe("the open-source targets' capability flags", () => {
  const targets = [new LocalTarget(), new LocalExecutionTarget(), new LocalPostgresTarget(), new LocalPostgresExecutionTarget()];

  it.each(targets.map((t) => [t.name, t] as const))("%s claims no surface only an edition above open source serves", (_name, target) => {
    const claimed = ABOVE_OPEN_SOURCE.filter((flag) => target.capabilities[flag]);
    expect(claimed).toEqual([]);
  });

  it.each(targets.map((t) => [t.name, t] as const))("%s serves no teams, and dials under the library's relaxed posture", (_name, target) => {
    expect(target.capabilities.teams).toBe("unimplemented");
    expect(target.capabilities.outboundEgress).toBe("relaxed");
  });

  it.each(targets.map((t) => [t.name, t] as const))("%s admits a Cursor run at create: open source asks no provider key", (_name, target) => {
    expect(target.capabilities.cursorRunsAdmitted).toBe(true);
  });

  it("the Postgres twins inherit their in-memory targets' flags exactly", () => {
    expect(new LocalPostgresTarget().capabilities).toEqual(new LocalTarget().capabilities);
    expect(new LocalPostgresExecutionTarget().capabilities).toEqual(new LocalExecutionTarget().capabilities);
  });
});
