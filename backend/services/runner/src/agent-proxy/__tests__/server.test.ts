/**
 * The runner's local proxy (`agent-proxy/server.ts`), lane by lane, against
 * a fake upstream on loopback that records what it was sent.
 *
 * What a host token buys, refused otherwise:
 *  - only the current host's token, as a bearer or an `x-api-key`;
 *  - a model call only for an execution with a turn live on this runner;
 *  - a checkpoint call only for a live turn's thread, in its query and in
 *    every entry of a write;
 *  - the model registry with no live turn, the one exemption.
 *
 * What each lane does, the one rule (swap the credential, forward the
 * bytes) in its two modes:
 *  - terminate (a runner that calls its providers itself): the operator's
 *    key or the runner's signature reaches the provider, the host's token
 *    and the platform's scope headers do not, and the provider's answer
 *    comes back unchanged — status, headers and stream;
 *  - forward (a runner behind the Stigmer platform's proxy): the runner's
 *    control-plane token replaces the host's, the execution id passes (the
 *    one scope header the proxy checks) and no other scope header does, and
 *    only the platform's lanes are served.
 */

import type { IncomingHttpHeaders } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getRequestHeaders(): Promise<Headers> {
      return new Headers({ authorization: "Bearer google-token", "x-goog-user-project": "real-project" });
    }
    async getProjectId(): Promise<string> {
      return "real-project";
    }
  },
}));

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import type { Config } from "../../config.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-0123456789";
const RUNNER_TOKEN = "runner-control-plane-token";
const EXECUTION = "aex-live";
const SESSION = "ses-live";
const BODY = JSON.stringify({ model: "claude-sonnet-4-5", stream: true, messages: [{ role: "user", content: "hi" }] });

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
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

async function startProxy(overrides: Partial<Config> = {}): Promise<AgentProxy> {
  const proxy = await AgentProxy.start(testConfig({ stigmerTokenRef: { current: RUNNER_TOKEN }, ...overrides }));
  proxy.authorizeHost(HOST_TOKEN);
  return proxy;
}

function call(proxy: AgentProxy, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  return fetch(`${proxy.endpoint}${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    ...(init.body !== undefined ? { body: init.body } : init.method === "GET" || init.method === "DELETE" ? {} : { body: BODY }),
  });
}

const asHost = { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION };

describe("what a host token buys", () => {
  it("refuses a call with no token, a wrong one, or a previous host's", async () => {
    // A provider that would answer: a refusal is the proxy's own, never one the upstream gave.
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
    try {
      const none = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { "x-stigmer-execution-id": EXECUTION } });
      expect(none.status).toBe(401);
      expect(await none.json(), "in the shape the providers' SDKs parse").toEqual({
        type: "error",
        error: { type: "authentication_error", message: "the agent proxy accepts the current agent host's token only" },
      });
      const wrong = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asHost, authorization: "Bearer not-the-token" } });
      expect(wrong.status).toBe(401);
      const sameLength = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asHost, authorization: `Bearer ${"x".repeat(HOST_TOKEN.length)}` } });
      expect(sameLength.status, "a token of the right length is still compared").toBe(401);
      proxy.authorizeHost("the-next-host");
      const previous = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost });
      expect(previous.status, "a token from a host that was replaced is worth nothing").toBe(401);
      expect(upstream.received).toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });

  it("accepts the token as x-api-key, where the Anthropic SDK puts a key", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    const close = proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
    try {
      const res = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { "x-api-key": HOST_TOKEN, "x-stigmer-execution-id": EXECUTION } });
      expect(res.status).toBe(200);
    } finally {
      close();
      await proxy.close();
    }
  });

  it("serves a model call only for an execution whose turn is live", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    try {
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { authorization: `Bearer ${HOST_TOKEN}` } })).status, "no execution named").toBe(403);
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost })).status, "no turn live").toBe(403);
      const close = proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost })).status, "live").toBe(200);
      close();
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost })).status, "settled").toBe(403);
      expect(upstream.received).toHaveLength(1);
    } finally {
      await proxy.close();
    }
  });

  it("reads the model registry with no live turn, as the runner, with the runner's credential", async () => {
    setEnv({ STIGMER_CLOUD_API_URL: upstream.url, STIGMER_TOKEN: RUNNER_TOKEN });
    upstream.answer = { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=3600" }, body: '{"models":[]}' };
    const proxy = await startProxy();
    try {
      const res = await call(proxy, "/v1/proxy/model-registry", { method: "GET", headers: { authorization: `Bearer ${HOST_TOKEN}` } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"models":[]}');
      expect(res.headers.get("cache-control")).toBe("max-age=3600");
      expect(upstream.last.path).toBe("/v1/proxy/model-registry");
      expect(upstream.last.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
    } finally {
      await proxy.close();
      upstream.answer = FakeUpstream.DEFAULT_ANSWER;
    }
  });

  it("refuses every call before a host is authorized, a registry read that is not a GET, and a checkpoint write that is not JSON", async () => {
    const proxy = await AgentProxy.start(testConfig({ proxyEndpoint: upstream.url, checkpointerType: "http", checkpointerProxyEndpoint: upstream.url }));
    try {
      expect((await call(proxy, "/v1/proxy/model-registry", { method: "GET", headers: { authorization: `Bearer ${HOST_TOKEN}` } })).status, "no host yet").toBe(401);
      proxy.authorizeHost(HOST_TOKEN);
      expect((await call(proxy, "/v1/proxy/model-registry", { headers: { authorization: `Bearer ${HOST_TOKEN}` } })).status).toBe(405);
      const close = proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
      close();
      close();
      proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
      expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint", { method: "PUT", headers: asHost, body: "not json" })).status).toBe(400);
      expect(upstream.received).toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });

  it("serves no lane outside its table", async () => {
    const proxy = await startProxy();
    try {
      expect((await call(proxy, "/v1/proxy/llm/somewhere/v1/x", { headers: asHost })).status).toBe(404);
      expect((await call(proxy, "/v1/runs/aex-live", { method: "GET", headers: asHost })).status, "the Stigmer API is the runner's own").toBe(404);
      expect(upstream.received).toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });
});

describe("terminate: a runner that calls its providers itself", () => {
  let proxy: AgentProxy;
  let closeTurn: () => void;

  beforeEach(async () => {
    proxy = await startProxy({ proxyEndpoint: null });
    closeTurn = proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
  });
  afterEach(async () => {
    closeTurn();
    await proxy.close();
  });

  /** The host's token and the platform's scope headers never reach a provider. */
  function expectNoHostCredential(headers: IncomingHttpHeaders): void {
    expect(JSON.stringify(headers)).not.toContain(HOST_TOKEN);
    expect(Object.keys(headers).filter((h) => h.startsWith("x-stigmer-"))).toEqual([]);
  }

  it("anthropic: the operator's key, the provider's own path, the body and the answer unchanged", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const res = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages?beta=true", {
      headers: { ...asHost, "x-api-key": HOST_TOKEN, "anthropic-version": "2023-06-01", "anthropic-beta": "interleaved-thinking-2025-05-14" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("event: message_start\ndata: {}\n\n");
    expect(res.headers.get("request-id")).toBe("req-upstream");
    expect(res.headers.get("x-ratelimit-remaining"), "the provider's own headers come back for the SDK").toBe("41");
    expect(upstream.last.path).toBe("/v1/messages?beta=true");
    expect(upstream.last.headers["x-api-key"]).toBe("sk-operator");
    expect(upstream.last.headers.authorization).toBeUndefined();
    expect(upstream.last.headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14");
    expect(upstream.last.body).toBe(BODY);
    expectNoHostCredential(upstream.last.headers);
  });

  it("openai: the operator's key as a bearer, under the SDK's own base", async () => {
    setEnv({ OPENAI_BASE_URL: `${upstream.url}/v1`, OPENAI_API_KEY: "sk-openai" });
    await call(proxy, "/v1/proxy/llm/openai/v1/chat/completions", { headers: asHost });

    expect(upstream.last.path).toBe("/v1/chat/completions");
    expect(upstream.last.headers.authorization).toBe("Bearer sk-openai");
    expectNoHostCredential(upstream.last.headers);
  });

  it("bedrock: the runner's bearer token when it has one", async () => {
    setEnv({ AWS_REGION: "ap-south-1", ANTHROPIC_BEDROCK_BASE_URL: upstream.url, AWS_BEARER_TOKEN_BEDROCK: "bedrock-bearer" });
    await call(proxy, "/v1/proxy/llm/bedrock/model/anthropic.claude-v1%3A0/invoke-with-response-stream", { headers: asHost });

    expect(upstream.last.path).toBe("/model/anthropic.claude-v1%3A0/invoke-with-response-stream");
    expect(upstream.last.headers.authorization).toBe("Bearer bedrock-bearer");
    expectNoHostCredential(upstream.last.headers);
  });

  it("bedrock: a SigV4 signature from the runner's AWS identity otherwise, for the real host", async () => {
    setEnv({
      AWS_REGION: "ap-south-1",
      ANTHROPIC_BEDROCK_BASE_URL: upstream.url,
      AWS_BEARER_TOKEN_BEDROCK: undefined,
      AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      AWS_PROFILE: undefined,
    });
    await call(proxy, "/v1/proxy/llm/bedrock/model/anthropic.claude-v1%3A0/invoke", { headers: asHost });

    expect(upstream.last.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/bedrock\/aws4_request, SignedHeaders=/);
    expect(upstream.last.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(upstream.last.headers.host, "the signed host is the one the request reaches").toBe(new URL(upstream.url).host.split(":")[0]);
    expectNoHostCredential(upstream.last.headers);
  });

  it("vertex: the runner's Google token, and the runner's project in place of the host's placeholder", async () => {
    setEnv({ CLOUD_ML_REGION: "us-east5", ANTHROPIC_VERTEX_BASE_URL: upstream.url, ANTHROPIC_VERTEX_PROJECT_ID: undefined });
    await call(proxy, "/v1/proxy/llm/vertex/projects/stigmer-lane/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-5@20250929:streamRawPredict", { headers: asHost });

    expect(upstream.last.path).toBe("/projects/real-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-5@20250929:streamRawPredict");
    expect(upstream.last.headers.authorization).toBe("Bearer google-token");
    expectNoHostCredential(upstream.last.headers);
  });

  it("foundry: the operator's key under the resource's own base", async () => {
    setEnv({ ANTHROPIC_FOUNDRY_BASE_URL: `${upstream.url}/anthropic/`, ANTHROPIC_FOUNDRY_RESOURCE: undefined, ANTHROPIC_FOUNDRY_API_KEY: "foundry-key" });
    await call(proxy, "/v1/proxy/llm/foundry/v1/messages", { headers: asHost });

    expect(upstream.last.path).toBe("/anthropic/v1/messages");
    expect(upstream.last.headers["x-api-key"]).toBe("foundry-key");
    expectNoHostCredential(upstream.last.headers);
  });

  it("relays a provider's refusal verbatim, for the host's classifier to read", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    upstream.answer = { status: 429, headers: { "content-type": "application/json", "retry-after": "7" }, body: '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' };
    try {
      const res = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("7");
      expect(await res.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    } finally {
      upstream.answer = FakeUpstream.DEFAULT_ANSWER;
    }
  });

  it("answers an unreachable provider with a gateway error", async () => {
    setEnv({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_API_KEY: "sk-operator" });
    const res = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost });
    expect(res.status).toBe(502);
  });

  it("serves no checkpoint lane: this runner checkpoints locally", async () => {
    const res = await call(proxy, `/v1/proxy/checkpoints/checkpoint?thread_id=thread-${SESSION}`, { method: "GET", headers: asHost });
    expect(res.status).toBe(404);
  });
});

describe("forward: a runner behind the Stigmer platform's proxy", () => {
  let proxy: AgentProxy;
  let closeTurn: () => void;

  beforeEach(async () => {
    proxy = await startProxy({ proxyEndpoint: upstream.url, checkpointerType: "http", checkpointerProxyEndpoint: upstream.url });
    closeTurn = proxy.openTurn({ executionId: EXECUTION, sessionId: SESSION });
  });
  afterEach(async () => {
    closeTurn();
    await proxy.close();
  });

  it("swaps the host's token for the runner's and keeps the scope the platform authorizes by", async () => {
    await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", {
      headers: { ...asHost, "x-api-key": HOST_TOKEN, "x-stigmer-mcp-server-id": "mcp-the-host-names", "x-stigmer-caller-kind": "operator" },
    });

    expect(upstream.last.path).toBe("/v1/proxy/llm/anthropic/v1/messages");
    expect(upstream.last.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
    expect(upstream.last.headers["x-stigmer-execution-id"]).toBe(EXECUTION);
    expect(Object.keys(upstream.last.headers).filter((h) => h.startsWith("x-stigmer-")), "only the checked scope passes").toEqual(["x-stigmer-execution-id"]);
    expect(JSON.stringify(upstream.last.headers)).not.toContain(HOST_TOKEN);
  });

  it("serves only the platform's model lanes", async () => {
    expect((await call(proxy, "/v1/proxy/llm/bedrock/model/x/invoke", { headers: asHost })).status).toBe(404);
  });

  it("forwards a live turn's checkpoints with the runner's token, and refuses any other thread", async () => {
    const thread = `thread-${SESSION}`;
    const read = await call(proxy, `/v1/proxy/checkpoints/checkpoint?thread_id=${thread}&checkpoint_ns=`, { method: "GET", headers: asHost });
    expect(read.status).toBe(200);
    expect(upstream.last.path).toBe(`/v1/proxy/checkpoints/checkpoint?thread_id=${thread}&checkpoint_ns=`);
    expect(upstream.last.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);

    const sent = upstream.received.length;
    expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint?thread_id=thread-ses-other", { method: "GET", headers: asHost })).status).toBe(403);
    const mixed = JSON.stringify({ writes: [{ thread_id: thread }, { thread_id: "thread-ses-other" }] });
    expect((await call(proxy, "/v1/proxy/checkpoints/writes", { method: "PUT", headers: asHost, body: mixed })).status, "every entry of a write").toBe(403);
    expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint", { method: "PUT", headers: asHost, body: JSON.stringify({ checkpoint_id: "c" }) })).status, "a write that names no thread").toBe(403);
    expect(upstream.received).toHaveLength(sent);
  });
});
