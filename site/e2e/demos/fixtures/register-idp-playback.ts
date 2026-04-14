import type { DemoFixture } from "../types";

export const registerIdpPlayback: DemoFixture = {
  scenarioId: "register-idp-playback",
  pagePath: "/docs/guides/federation/register-identity-provider",
  contract: {
    // Step 0: scroll-to at 55% reveals audience field
    0: { targets: ["audience-field"] },
  },
};
