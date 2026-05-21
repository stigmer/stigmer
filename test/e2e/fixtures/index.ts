import { test as base, expect } from "@playwright/test";
import { createNodeClient } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import {
  createTestAgent,
  createTestWorkflow,
  type TestAgentResult,
  type TestWorkflowResult,
} from "./seed-helpers";

type WorkerFixtures = {
  stigmerClient: Stigmer;
};

type TestFixtures = {
  testAgent: TestAgentResult;
  testWorkflow: TestWorkflowResult;
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

  testAgent: async ({ stigmerClient }, use) => {
    const result = await createTestAgent(stigmerClient);
    await use(result);
    await result.cleanup();
  },

  testWorkflow: async ({ stigmerClient }, use) => {
    const result = await createTestWorkflow(stigmerClient);
    await use(result);
    await result.cleanup();
  },
});

export { expect };
