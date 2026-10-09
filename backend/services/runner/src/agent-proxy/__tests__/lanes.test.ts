/**
 * The local proxy's lanes when the runner's own settings or identity cannot
 * serve the call (`agent-proxy/lanes.ts`): each is answered with a status
 * and a sentence the host's SDK surfaces, never a hang or an unanswered
 * request, and never a call made with a credential the runner does not
 * have.
 *
 * Pinned, through the server (`agent-proxy/server.ts`) against a fake
 * provider:
 *  - a setting a lane needs is missing or malformed (the Anthropic gateway,
 *    the Bedrock and Vertex regions, the Foundry resource): 500 naming it;
 *  - the OpenAI lane serves only the SDK's `/v1` paths: 404;
 *  - the runner's cloud identity cannot be had (no AWS credentials, no
 *    Google credentials, no Azure token): 502 with the identity's own words;
 *  - a forwarding runner that holds no Stigmer credential: 503;
 *  - with an Azure identity and no Foundry key, the call carries the
 *    identity's token;
 *  - the Vertex endpoint for each kind of region, as the Vertex SDK names it;
 *  - a path that names another origin (a scheme, or `//`) stays on the
 *    lane's own host: the runner's key never leaves for a host the agent
 *    host names.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identities = vi.hoisted(() => ({ google: "ok" as "ok" | "fail", azure: "ok" as "ok" | "fail" }));

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getRequestHeaders(): Promise<Headers> {
      if (identities.google === "fail") throw new Error("Could not load the default credentials");
      return new Headers({ authorization: "Bearer google-token" });
    }
    async getProjectId(): Promise<string> {
      return "real-project";
    }
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {},
  getBearerTokenProvider: () => async () => {
    if (identities.azure === "fail") throw new Error("ChainedTokenCredential authentication failed");
    return "azure-token";
  },
}));

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import type { Config } from "../../config.js";
import { laneUrl, vertexBase } from "../lanes.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-lanes";
const EXECUTION = "aex-lanes-edges";
const asHost = { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION, "content-type": "application/json" };

const upstream = new FakeUpstream();
const saved = new Map<string, string | undefined>();

function setEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeAll(() => upstream.start());
afterAll(() => upstream.stop());
beforeEach(() => {
  upstream.received.length = 0;
  identities.google = "ok";
  identities.azure = "ok";
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

async function ask(path: string, overrides: Partial<Config> = {}): Promise<{ readonly status: number; readonly message: string }> {
  const proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null, ...overrides }));
  proxy.authorizeHost(HOST_TOKEN);
  const close = proxy.openTurn({ executionId: EXECUTION, sessionId: "ses-lanes-edges" });
  try {
    const res = await fetch(`${proxy.endpoint}${path}`, { method: "POST", headers: asHost, body: "{}" });
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      // the provider's own body, relayed as it came
    }
    return { status: res.status, message };
  } finally {
    close();
    await proxy.close();
  }
}

describe("a lane the runner's settings cannot serve", () => {
  it("names a malformed Anthropic gateway", async () => {
    setEnv({ ANTHROPIC_BASE_URL: "not a url" });
    const { status, message } = await ask("/v1/proxy/llm/anthropic/v1/messages");
    expect(status).toBe(500);
    expect(message).toMatch(/ANTHROPIC_BASE_URL="not a url" is not an http\(s\) URL/);
  });

  it("serves only the OpenAI SDK's /v1 paths", async () => {
    const { status, message } = await ask("/v1/proxy/llm/openai/models");
    expect(status).toBe(404);
    expect(message).toBe("the openai lane serves /v1 paths only");
  });

  it("names the region Bedrock and Vertex need, and the resource Foundry needs", async () => {
    setEnv({ AWS_REGION: undefined, CLOUD_ML_REGION: undefined, ANTHROPIC_FOUNDRY_RESOURCE: undefined, ANTHROPIC_FOUNDRY_BASE_URL: undefined });
    expect(await ask("/v1/proxy/llm/bedrock/model/x/invoke")).toEqual({ status: 500, message: "the bedrock lane needs AWS_REGION on the runner" });
    expect(await ask("/v1/proxy/llm/vertex/projects/p/locations/l/x")).toEqual({ status: 500, message: "the vertex lane needs CLOUD_ML_REGION on the runner" });
    expect(await ask("/v1/proxy/llm/foundry/v1/messages")).toEqual({
      status: 500,
      message: "the foundry lane needs ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL on the runner",
    });
  });

  it("refuses to forward for a runner that holds no Stigmer credential", async () => {
    const result = await ask("/v1/proxy/llm/anthropic/v1/messages", { proxyEndpoint: upstream.url, stigmerTokenRef: { current: null } });
    expect(result).toEqual({ status: 503, message: "the runner holds no Stigmer credential to forward this call with" });
    expect(upstream.received).toEqual([]);
  });
});

describe("a lane the runner's cloud identity cannot serve", () => {
  it("answers 502 with the AWS chain's own words when there are no AWS credentials", async () => {
    const empty = mkdtempSync(join(tmpdir(), "stigmer-no-aws-"));
    writeFileSync(join(empty, "config"), "");
    writeFileSync(join(empty, "credentials"), "");
    setEnv({
      AWS_REGION: "ap-south-1",
      ANTHROPIC_BEDROCK_BASE_URL: upstream.url,
      AWS_BEARER_TOKEN_BEDROCK: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_SESSION_TOKEN: undefined,
      AWS_PROFILE: undefined,
      AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
      AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
      AWS_CONFIG_FILE: join(empty, "config"),
      AWS_SHARED_CREDENTIALS_FILE: join(empty, "credentials"),
      AWS_EC2_METADATA_DISABLED: "true",
    });
    try {
      const { status, message } = await ask("/v1/proxy/llm/bedrock/model/x/invoke");
      expect(status).toBe(502);
      expect(message).toMatch(/^Failed to resolve AWS credentials from the credential provider chain\. \(.+\)$/);
      expect(upstream.received).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("answers 502 when Google credentials cannot be had", async () => {
    identities.google = "fail";
    setEnv({ CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_BASE_URL: upstream.url });
    const { status, message } = await ask("/v1/proxy/llm/vertex/projects/p/locations/us-east5/x:rawPredict");
    expect(status).toBe(502);
    expect(message).toBe("Failed to acquire Google OAuth credentials: Could not load the default credentials");
  });

  it("carries the Azure identity's token when there is no Foundry key, and answers 502 when there is none", async () => {
    setEnv({ ANTHROPIC_FOUNDRY_BASE_URL: `${upstream.url}/anthropic/`, ANTHROPIC_FOUNDRY_RESOURCE: undefined, ANTHROPIC_FOUNDRY_API_KEY: undefined });
    await ask("/v1/proxy/llm/foundry/v1/messages");
    expect(upstream.last.headers.authorization).toBe("Bearer azure-token");

    identities.azure = "fail";
    const { status, message } = await ask("/v1/proxy/llm/foundry/v1/messages");
    expect(status).toBe(502);
    expect(message).toBe("Failed to acquire an Azure token for Microsoft Foundry: ChainedTokenCredential authentication failed");
  });
});

describe("a path that names another origin", () => {
  const elsewhere = new FakeUpstream();
  beforeAll(() => elsewhere.start());
  afterAll(() => elsewhere.stop());

  it("stays on each lane's own host, the runner's key with it", async () => {
    const away = new URL(elsewhere.url);
    setEnv({
      ANTHROPIC_FOUNDRY_BASE_URL: `${upstream.url}/anthropic/`,
      ANTHROPIC_FOUNDRY_API_KEY: "foundry-key-stays-home",
      ANTHROPIC_BASE_URL: upstream.url,
      ANTHROPIC_API_KEY: "anthropic-key-stays-home",
      OPENAI_BASE_URL: `${upstream.url}/v1`,
      OPENAI_API_KEY: "openai-key-stays-home",
    });
    for (const path of [
      `/v1/proxy/llm/foundry/${elsewhere.url}/v1/messages`,
      `/v1/proxy/llm/foundry//${away.host}/v1/messages`,
      `/v1/proxy/llm/anthropic/${elsewhere.url}/v1/messages`,
      `/v1/proxy/llm/anthropic//${away.host}/v1/messages`,
      `/v1/proxy/llm/openai/v1/${elsewhere.url}/x`,
    ]) {
      await ask(path);
    }
    expect(elsewhere.received, "a request reached the other origin").toEqual([]);
    expect(upstream.received.length).toBe(5);
  });

  it("is refused when the joined URL would leave the lane's origin or its path", () => {
    expect(laneUrl("https://res.services.ai.azure.com/anthropic/", "/v1/messages").toString()).toBe("https://res.services.ai.azure.com/anthropic/v1/messages");
    expect(() => laneUrl("https://api.anthropic.com", "@elsewhere.example/v1/messages")).toThrow("the lane's path must stay under the lane's own endpoint");
    expect(() => laneUrl("https://res.services.ai.azure.com/anthropic", "/../other/v1/messages")).toThrow("the lane's path must stay under the lane's own endpoint");
  });
});

describe("the Vertex endpoint", () => {
  it("is the one the Vertex SDK names for each kind of region", () => {
    expect(vertexBase("global")).toBe("https://aiplatform.googleapis.com/v1");
    expect(vertexBase("us")).toBe("https://aiplatform.us.rep.googleapis.com/v1");
    expect(vertexBase("eu")).toBe("https://aiplatform.eu.rep.googleapis.com/v1");
    expect(vertexBase("us-east5")).toBe("https://us-east5-aiplatform.googleapis.com/v1");
  });
});
