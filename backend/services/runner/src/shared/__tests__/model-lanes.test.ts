/**
 * Provider lanes end to end: a model client built in a process that holds
 * no provider credential (the agent host's posture, `shared/model-lanes.ts`)
 * reaches the provider through the runner's local proxy, and the provider
 * sees the operator's credential, never the host's token.
 *
 * One test per direct-mode backend the model client builds
 * (`shared/model-client.ts`): the public Anthropic API, OpenAI, Bedrock,
 * Vertex and Foundry. Each runs the REAL client from `buildChatModel` with
 * lanes installed, against the REAL proxy (`agent-proxy/server.ts`) in
 * terminate mode, against a fake provider on loopback. What each pins:
 *
 *  - the client's request reached the provider only through its lane (the
 *    provider sees the proxy's relay: no `x-stigmer-*` header, the
 *    operator's key);
 *  - the backend's own wire is kept — Bedrock's model path, Vertex's
 *    project path with the runner's project, Foundry's resource base — so
 *    the client's model-id translation is still the client's;
 *  - the answer parses: the SDK reads the provider's response as its own.
 *
 * And one negative: without lanes, a client built in this process would
 * have used the key (the default the runner itself keeps).
 */

import { HumanMessage } from "@langchain/core/messages";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getRequestHeaders(): Promise<Headers> {
      return new Headers({ authorization: "Bearer google-token" });
    }
    async getProjectId(): Promise<string> {
      return "real-project";
    }
  },
}));

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { AgentProxy } from "../../agent-proxy/server.js";
import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";
import { resetModelLanesForTests, routeModelCallsThroughLanes } from "../model-lanes.js";

const HOST_TOKEN = "host-token-for-lanes";
const EXECUTION = "aex-lanes";

const REGISTRY = {
  models: [
    { id: "claude-sonnet-4.5", apiModelId: "claude-sonnet-4-5-20250929", provider: "anthropic", harness: "native", costTier: "standard", capabilities: {}, pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15 } },
    { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai", harness: "native", costTier: "standard", capabilities: {}, pricing: { inputPricePerMillion: 2, outputPricePerMillion: 8 } },
  ],
};

const ANTHROPIC_ANSWER = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    content: [{ type: "text", text: "from the provider" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 4 },
  }),
};

const OPENAI_ANSWER = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "gpt-4.1",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "from the provider" } }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  }),
};

const BACKEND_ENV = [
  "STIGMER_ANTHROPIC_BACKEND",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "AWS_REGION",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_API_KEY",
] as const;

const upstream = new FakeUpstream();
let proxy: AgentProxy;
let closeTurn: () => void;
let registry: ReturnType<typeof stubRegistryFetch>;
const saved = new Map<string, string | undefined>();

beforeAll(async () => {
  await upstream.start();
  proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null }));
  proxy.authorizeHost(HOST_TOKEN);
  closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-lanes" });
});

afterAll(async () => {
  closeTurn();
  await proxy.close();
  await upstream.stop();
});

beforeEach(() => {
  for (const name of BACKEND_ENV) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  upstream.received.length = 0;
  _resetRegistryCache();
  registry = stubRegistryFetch({ live: true, document: REGISTRY });
  routeModelCallsThroughLanes(proxy.endpoint, HOST_TOKEN);
});

afterEach(() => {
  resetModelLanesForTests();
  registry.restore();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function ask(modelName: string): Promise<string> {
  const { model } = await buildChatModel({ modelName, headerScope: { executionId: EXECUTION }, maxTokens: 16 });
  const reply = await model.invoke([new HumanMessage("hi")]);
  return typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content);
}

/** The provider was reached through the proxy: the relay's marks, the operator's key, never the host's token. */
function expectRelayedWithOperatorCredential(credentialHeader: string, value: string): void {
  const { headers } = upstream.last;
  expect(headers[credentialHeader]).toBe(value);
  expect(JSON.stringify(headers)).not.toContain(HOST_TOKEN);
  expect(Object.keys(headers).filter((h) => h.startsWith("x-stigmer-"))).toEqual([]);
}

describe("a model client with no credential, through its lane", () => {
  it("public Anthropic: the operator's key at the provider", async () => {
    Object.assign(process.env, { ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    upstream.answer = ANTHROPIC_ANSWER;

    expect(await ask("claude-sonnet-4.5")).toBe("from the provider");
    expect(upstream.last.path).toBe("/v1/messages");
    expect(JSON.parse(upstream.last.body).model, "the registry's id, resolved by the client").toBe("claude-sonnet-4-5-20250929");
    expectRelayedWithOperatorCredential("x-api-key", "sk-operator");
  });

  it("OpenAI: the operator's key as a bearer", async () => {
    Object.assign(process.env, { OPENAI_BASE_URL: `${upstream.url}/v1`, OPENAI_API_KEY: "sk-openai" });
    upstream.answer = OPENAI_ANSWER;

    expect(await ask("gpt-4.1")).toBe("from the provider");
    expect(upstream.last.path).toBe("/v1/chat/completions");
    expectRelayedWithOperatorCredential("authorization", "Bearer sk-openai");
  });

  it("Bedrock: the client's own model path, the runner's bearer token", async () => {
    Object.assign(process.env, {
      STIGMER_ANTHROPIC_BACKEND: "bedrock",
      AWS_REGION: "ap-south-1",
      ANTHROPIC_BEDROCK_BASE_URL: upstream.url,
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-bearer",
    });
    upstream.answer = ANTHROPIC_ANSWER;

    expect(await ask("claude-sonnet-4.5")).toBe("from the provider");
    expect(upstream.last.path, "the Bedrock id the client translated").toBe("/model/anthropic.claude-sonnet-4-5-20250929-v1:0/invoke");
    expect(JSON.parse(upstream.last.body).anthropic_version).toBe("bedrock-2023-05-31");
    expectRelayedWithOperatorCredential("authorization", "Bearer bedrock-bearer");
  });

  it("Vertex: the client's own path with the runner's project, the runner's Google token", async () => {
    Object.assign(process.env, { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_BASE_URL: upstream.url });
    upstream.answer = ANTHROPIC_ANSWER;

    expect(await ask("claude-sonnet-4.5")).toBe("from the provider");
    expect(upstream.last.path).toBe("/projects/real-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-5@20250929:rawPredict");
    expectRelayedWithOperatorCredential("authorization", "Bearer google-token");
  });

  it("Foundry: the operator's key under the resource's base, the deployment the client named", async () => {
    Object.assign(process.env, {
      STIGMER_ANTHROPIC_BACKEND: "foundry",
      ANTHROPIC_FOUNDRY_BASE_URL: `${upstream.url}/anthropic/`,
      ANTHROPIC_FOUNDRY_API_KEY: "foundry-key",
    });
    upstream.answer = ANTHROPIC_ANSWER;

    expect(await ask("claude-sonnet-4.5")).toBe("from the provider");
    expect(upstream.last.path).toBe("/anthropic/v1/messages");
    expect(JSON.parse(upstream.last.body).model, "the deployment name the client derived").toBe("claude-sonnet-4-5");
    expectRelayedWithOperatorCredential("x-api-key", "foundry-key");
  });

  it("without lanes the same client calls the provider with the key itself (the runner's own posture)", async () => {
    resetModelLanesForTests();
    Object.assign(process.env, { ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    upstream.answer = ANTHROPIC_ANSWER;

    expect(await ask("claude-sonnet-4.5")).toBe("from the provider");
    expect(upstream.last.headers["x-api-key"]).toBe("sk-operator");
    expect(upstream.last.headers["accept-encoding"], "no relay in between").not.toBe("identity");
  });
});
