import type { DemoFixture } from "../types";

export const byoaSetup: DemoFixture = {
  scenarioId: "byoa-setup",
  pagePath: "/docs/guides/integrations/bring-your-own-oauth",
  contract: {
    // Step 0: scroll-to at 40% reveals bottom of capabilities
    0: { targets: ["capabilities-bottom"] },
    // Step 4: scroll-to at 30% reveals connected server capabilities
    4: { targets: ["capabilities-bottom"] },
    // Step 5: scroll-to at 30% reveals final connected state
    5: { targets: ["capabilities-bottom"] },
  },
};
