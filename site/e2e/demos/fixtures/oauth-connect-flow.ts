import type { DemoFixture } from "../types";

export const oauthConnectFlow: DemoFixture = {
  scenarioId: "oauth-connect-flow",
  pagePath: "/docs/guides/integrations/oauth-for-tools",
  contract: {
    // Step 0: scroll-to at 40% reveals OAuth section
    0: { targets: ["capabilities-bottom"] },
    // Step 3: scroll-to at 35% reveals tools list
    3: { targets: ["capabilities-bottom"] },
  },
};
