/**
 * The GenerateSessionSubject activity's wire contract: one argument in one of
 * two shapes — the positional execution id every server has sent, and the
 * typed object a server sends when the dispatch carries the run credential.
 * Both reach the same core with the same execution id; the credential is the
 * activity boundary's business, not this activity's (the header explains).
 *
 * The client is the hermetic module seam (`__test-utils__/hermetic-activity.ts`)
 * because the factory constructs its own `StigmerClient`; the LLM seam is
 * module-mocked to return a fixed title.
 */

import { describe, expect, it, vi } from "vitest";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { bindHermeticClient } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";

vi.mock("../../client/stigmer-client.js", async () =>
  (
    await import("../../__test-utils__/hermetic-activity.js")
  ).hermeticStigmerClientModule(),
);
vi.mock("../../shared/model-registry.js", () => ({
  getSummarizationModel: vi.fn(async (primary: string) => primary),
}));
vi.mock("../../shared/model-client.js", () => ({
  buildChatModel: vi.fn(async () => ({
    model: { invoke: vi.fn(async () => ({ content: "Indexing Basics" })) },
  })),
}));
vi.mock("../../shared/llm-backend.js", () => ({
  checkDirectCredentials: vi.fn(() => null),
}));
vi.mock("../../shared/llm-proxy.js", () => ({
  tryInferProvider: vi.fn(() => "anthropic"),
}));

import {
  AUTO_CREATED_SUBJECT,
  createGenerateSessionSubjectActivities,
} from "../generate-session-subject.js";
import type { Config } from "../../config.js";

const EXECUTION_ID = "aex_wire_1";

function clientReadingExecution(): {
  client: StigmerClient;
  reads: string[];
  titled: string[];
} {
  const reads: string[] = [];
  const titled: string[] = [];
  const client = mockStigmerClient({
    getExecution: vi.fn(async (executionId: string) => {
      reads.push(executionId);
      return {
        spec: {
          sessionId: "ses_1",
          agentId: "agt_1",
          message: "How do indexes work?",
        },
      } as never;
    }),
    getSession: vi.fn(
      async () =>
        ({
          spec: { subject: AUTO_CREATED_SUBJECT, agentInstanceId: "" },
        }) as never,
    ),
    getAgent: vi.fn(
      async () =>
        ({ metadata: { name: "a" }, spec: { description: "" } }) as never,
    ),
    updateSessionSubject: vi.fn(async (_sessionId: string, subject: string) => {
      titled.push(subject);
      return {} as never;
    }),
  });
  return { client, reads, titled };
}

function activityUnderTest() {
  const { client, reads, titled } = clientReadingExecution();
  bindHermeticClient(client);
  const config = {
    stigmerBackendEndpoint: "http://localhost:0",
    stigmerTokenRef: { current: null },
    proxyEndpoint: null,
    primaryModel: "claude-sonnet-4.5",
  } as unknown as Config;
  const { GenerateSessionSubject } =
    createGenerateSessionSubjectActivities(config);
  return { GenerateSessionSubject, reads, titled };
}

describe("GenerateSessionSubject wire shapes", () => {
  it("accepts the positional execution id — every earlier server's shape", async () => {
    const { GenerateSessionSubject, reads, titled } = activityUnderTest();
    await GenerateSessionSubject(EXECUTION_ID);
    expect(reads).toEqual([EXECUTION_ID]);
    expect(titled).toEqual(["Indexing Basics"]);
  });

  it("accepts the typed object carrying the run credential and reads the same execution", async () => {
    const { GenerateSessionSubject, reads, titled } = activityUnderTest();
    await GenerateSessionSubject({
      execution_id: EXECUTION_ID,
      execution_context_token: "run-cred",
    });
    expect(reads).toEqual([EXECUTION_ID]);
    expect(titled).toEqual(["Indexing Basics"]);
  });

  it("accepts the typed object without a credential", async () => {
    const { GenerateSessionSubject, reads } = activityUnderTest();
    await GenerateSessionSubject({ execution_id: EXECUTION_ID });
    expect(reads).toEqual([EXECUTION_ID]);
  });
});
