import { test as base, expect } from "@playwright/test";
import { createNodeClient } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import {
  createTestOrg,
  createTestAgent,
  createTestWorkflow,
  createTestWaitWorkflow,
  createMultiKindTestWorkflow,
  type TestOrgResult,
  type TestAgentResult,
  type TestWorkflowResult,
} from "./seed-helpers";

type WorkerFixtures = {
  stigmerClient: Stigmer;
};

type TestFixtures = {
  freshOrg: TestOrgResult;
  testAgent: TestAgentResult;
  testWorkflow: TestWorkflowResult;
  testWaitWorkflow: TestWorkflowResult;
  testMultiKindWorkflow: TestWorkflowResult;
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
  // the first page loads (the org switcher's own localStorage key), so a
  // spec sees only what it seeded.
  freshOrg: async ({ stigmerClient, page }, use) => {
    const result = await createTestOrg(stigmerClient);
    await page.addInitScript((slug) => {
      localStorage.setItem("stigmer:activeOrgSlug", slug);
    }, result.slug);
    await use(result);
    await result.cleanup();
  },

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

  testWaitWorkflow: async ({ stigmerClient }, use) => {
    const result = await createTestWaitWorkflow(stigmerClient);
    await use(result);
    await result.cleanup();
  },

  // The workflow's `agent_call` names an agent that must exist, so this
  // fixture is composed over `testAgent`; Playwright tears fixtures down in
  // reverse, so the workflow is deleted before the agent it references.
  testMultiKindWorkflow: async ({ stigmerClient, testAgent }, use) => {
    const result = await createMultiKindTestWorkflow(stigmerClient, {
      agentSlug: testAgent.slug,
    });
    await use(result);
    await result.cleanup();
  },
});

export { expect };
