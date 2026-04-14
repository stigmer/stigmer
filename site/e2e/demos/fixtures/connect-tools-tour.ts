import type { DemoFixture } from "../types";

export const connectToolsTour: DemoFixture = {
  scenarioId: "connect-tools-tour",
  pagePath: "/docs/getting-started/connect-tools",
  contract: {
    // Step 0: scroll-to at 25% reveals capabilities bottom
    0: { targets: ["capabilities-bottom"] },
  },
};
