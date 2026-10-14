// Pins the enterprise target's whole capability matrix as one literal, so
// no flag changes unseen.
//
// A flag decides which arms run and which pin a refusal: one flipped by
// accident would silently skip the arm that holds the edition to its word.
// Each value below is the edition's, read from what a licensed Enterprise
// server composes (targets/enterprise.ts gives the reason beside each).
// Constructing the target boots nothing, so this runs in the unit arms with
// no server.
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { describe, expect, it } from "vitest";

import { EnterpriseTarget } from "../enterprise";
import type { CapabilityFlags } from "../target";

const ENTERPRISE_MATRIX: CapabilityFlags = {
  multiTenant: true,
  singleOrganization: false,
  enforcingAuthorizer: true,
  versionTagging: true,
  skillArtifactTransferLane: true,
  scheduleFiring: false,
  runnerActsAsRunCreator: false,
  clientReservedLabelWrites: false,
  firstPartyMemoryCapture: true,
  channelMessaging: false,
  billingGates: false,
  billingEngine: false,
  billingPlans: false,
  sideChannelProxy: false,
  publicLane: false,
  guestMinting: false,
  cloudTargetRefusesLocalPrograms: false,
  runModelCallsMetered: false,
  userTokens: true,
  requiresAuthentication: true,
  directLogin: false,
  federatedIdentityAccounts: true,
  perResourceGrants: true,
  authorizationQueries: false,
  accessHistory: "served",
  membershipOnArrival: false,
  cursorRunsAdmitted: true,
  licenseStatus: "licensed",
  teams: "served",
  invitations: true,
  federationIssuers: true,
  outboundEgress: "relaxed",
};

describe("the enterprise target's capability flags", () => {
  it("are exactly the licensed Enterprise server's", () => {
    expect(new EnterpriseTarget().capabilities).toEqual(ENTERPRISE_MATRIX);
  });

  it("serve the Enterprise edition under the name the suite selects it by", () => {
    const target = new EnterpriseTarget();
    expect(target.name).toBe("enterprise");
    expect(target.edition).toBe(ServerEdition.enterprise);
  });
});
