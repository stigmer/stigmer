import type { DemoFixture } from "../types";

export const marketplaceConnectTour: DemoFixture = {
  scenarioId: "marketplace-connect-tour",
  pagePath: "/docs/guides/integrations/connect-from-marketplace",
  contract: {
    // Step 2 (detail-view): scroll-to fires at 40%, revealing capabilities
    2: { targets: ["capabilities-bottom"] },
    // Step 4 (connected-tools): scroll-to fires at 30%, showing tools list
    4: { targets: ["capabilities-bottom"] },
  },
};
