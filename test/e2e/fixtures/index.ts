import { test as base, expect } from "@playwright/test";
import { createNodeClient } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import {
  createTestOrg,
  createTestAgent,
  type TestOrgResult,
  type TestAgentResult,
} from "./seed-helpers";

type WorkerFixtures = {
  stigmerClient: Stigmer;
};

type TestFixtures = {
  freshOrg: TestOrgResult;
  testAgent: TestAgentResult;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stigmerClient: [
    async ({}, use) => {
      const baseUrl = process.env.STIGMER_E2E_API_URL ?? "http://localhost:7234";
      const client = createNodeClient({
        baseUrl,
        getAccessToken: () => null,
      });
      await use(client);
    },
    { scope: "worker" },
  ],

  // An organization of the test's own, made the console's active org before
  // the first page loads (the org switcher's own localStorage key, which
  // holds the organization's id), so a spec sees only what it seeded.
  freshOrg: async ({ stigmerClient, page }, use) => {
    const result = await createTestOrg(stigmerClient);
    await page.addInitScript((id) => {
      localStorage.setItem("stigmer:activeOrg", id);
    }, result.id);
    await use(result);
    await result.cleanup();
  },

  testAgent: async ({ stigmerClient }, use) => {
    const result = await createTestAgent(stigmerClient);
    await use(result);
    await result.cleanup();
  },
});

export { expect };
