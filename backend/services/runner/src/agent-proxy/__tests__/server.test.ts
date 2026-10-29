/**
 * The runner's local proxy (`agent-proxy/server.ts`), lane by lane, against
 * a fake upstream on loopback that records what it was sent.
 *
 * What a host token buys, refused otherwise:
 *  - only the current host's token, as a bearer or an `x-api-key`;
 *  - a model call only for an execution with a turn live on this runner;
 *  - a checkpoint call only for a live turn's thread, in its query and in
 *    every entry of a write;
 *  - an engine-session call (the Claude engine's transcript store) only for
 *    a live turn's own thread, in its query and in its body, and nothing
 *    once the turn has settled;
 *  - the model registry with no live turn, the one exemption;
 *  - on the Anthropic lane alone, a live turn's own key in place of the
 *    host's token (an engine that is its own program sends one key and no
 *    scope header), as that turn's execution and no other, and nothing once
 *    the turn has settled.
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
 *    only the platform's lanes are served;
 *  - the host's bearer token is read in time linear in the header, however
 *    many spaces it holds.
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
import { bearerOf } from "../relay.js";
import { HttpTranscripts } from "../../activities/execute-claude/http-store.js";
import { HttpCheckpointSaver } from "../../shared/checkpointer/http-saver.js";
import { runWithExecutionContext } from "../../shared/execution-context.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-0123456789";
const RUNNER_TOKEN = "runner-control-plane-token";
const EXECUTION = "run_live";
const SESSION = "ses-live";
const THREAD = `thread-${SESSION}`;
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

const TURN_KEY = "turn-key-live";
const asHost = { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION, "x-stigmer-turn-key": TURN_KEY };

describe("reading the host's bearer token", () => {
  it("takes the token after the scheme, in any case and spacing, and nothing else", () => {
    expect(bearerOf("Bearer abc")).toBe("abc");
    expect(bearerOf("bearer \t abc ")).toBe("abc");
    expect(bearerOf("Bearer ")).toBeUndefined();
    expect(bearerOf("Basic abc")).toBeUndefined();
    expect(bearerOf("Bearerabc")).toBeUndefined();
    expect(bearerOf(undefined)).toBeUndefined();
  });

  it("reads a header of many spaces at once (no backtracking pattern)", () => {
    const started = performance.now();
    expect(bearerOf(`bearer ${" ".repeat(200_000)}x`)).toBe("x");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("what a host token buys", () => {
  it("refuses a call with no token, a wrong one, or a previous host's", async () => {
    // A provider that would answer: a refusal is the proxy's own, never one the upstream gave.
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    try {
      const none = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { "x-stigmer-execution-id": EXECUTION, "x-stigmer-turn-key": TURN_KEY } });
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
    const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    try {
      const res = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { "x-api-key": HOST_TOKEN, "x-stigmer-execution-id": EXECUTION, "x-stigmer-turn-key": TURN_KEY } });
      expect(res.status).toBe(200);
    } finally {
      close();
      await proxy.close();
    }
  });

  it("lets a turn's key buy model calls for that turn's own execution only", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    const closeOwn = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    const closeOther = proxy.openTurn({ executionId: "run_other", threadId: "thread-ses-other", turnKey: "turn-key-other" });
    try {
      const borrowed = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asHost, "x-stigmer-execution-id": "run_other" } });
      expect(borrowed.status, "another live execution, named with this turn's key").toBe(403);
      expect(((await borrowed.json()) as { error: { message: string } }).error.message).toBe("the turn key is not execution run_other's");
      const forged = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asHost, "x-stigmer-turn-key": "turn-key-forged" } });
      expect(forged.status, "a key no turn holds").toBe(403);
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asHost, "x-stigmer-turn-key": "turn-key-other", "x-stigmer-execution-id": "run_other" } })).status, "the other turn, with its own key").toBe(200);
      expect(upstream.received).toHaveLength(1);
    } finally {
      closeOwn();
      closeOther();
      await proxy.close();
    }
  });

  it("serves a model call only for an execution whose turn is live", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    try {
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { authorization: `Bearer ${HOST_TOKEN}` } })).status, "no key, no execution").toBe(403);
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asHost })).status, "no turn live").toBe(403);
      const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
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
      const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
      close();
      close();
      proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
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
      expect((await call(proxy, "/v1/runs/run_live", { method: "GET", headers: asHost })).status, "the Stigmer API is the runner's own").toBe(404);
      expect(upstream.received).toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });
});

describe("what a turn's own key buys an engine that presents it as its credential", () => {
  const asEngine = { "x-api-key": TURN_KEY };

  it("a model call on the Anthropic lane, as that turn's, with neither the key nor the host's token sent on", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator" });
    const proxy = await startProxy();
    const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    try {
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asEngine })).status, "as an x-api-key").toBe(200);
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { authorization: `Bearer ${TURN_KEY}` } })).status, "as a bearer").toBe(200);
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages/count_tokens", { headers: asEngine })).status, "a token count").toBe(200);
      expect(upstream.received).toHaveLength(3);
      expect(upstream.last.headers["x-api-key"], "the operator's key reaches the provider").toBe("sk-operator");
      const sent = JSON.stringify(upstream.received.map((r) => r.headers));
      expect(sent).not.toContain(TURN_KEY);
      expect(sent).not.toContain(HOST_TOKEN);
    } finally {
      close();
      await proxy.close();
    }
  });

  it("is refused once its turn has settled, on every other lane, and for another execution", async () => {
    setEnv({ ANTHROPIC_BASE_URL: upstream.url, ANTHROPIC_API_KEY: "sk-operator", OPENAI_BASE_URL: upstream.url, OPENAI_API_KEY: "sk-openai" });
    const proxy = await startProxy();
    const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    proxy.openTurn({ executionId: "run_other", threadId: "thread-ses-other", turnKey: "turn-key-other" });
    try {
      expect((await call(proxy, "/v1/proxy/llm/openai/v1/chat/completions", { headers: { authorization: `Bearer ${TURN_KEY}` } })).status, "another model lane").toBe(401);
      expect((await call(proxy, `/v1/proxy/checkpoints/checkpoint?thread_id=${THREAD}`, { method: "GET", headers: { ...asEngine, "x-stigmer-turn-key": TURN_KEY } })).status, "the checkpoint lane").toBe(401);
      expect((await call(proxy, "/v1/proxy/model-registry", { method: "GET", headers: asEngine })).status, "the model registry").toBe(401);
      expect((await call(proxy, "/v1/proxy/otlp/v1/traces", { headers: asEngine })).status, "the telemetry lane").toBe(401);
      const named = await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: { ...asEngine, "x-stigmer-execution-id": "run_other" } });
      expect(named.status, "naming another live execution").toBe(403);
      expect(((await named.json()) as { error: { message: string } }).error.message).toBe("the turn key is not execution run_other's");
      close();
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asEngine })).status, "settled").toBe(401);
      expect(upstream.received, "nothing reached a provider").toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });

  it("forwards as that turn's execution, with the runner's token in place of the key", async () => {
    const proxy = await startProxy({ proxyEndpoint: upstream.url });
    const close = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    try {
      expect((await call(proxy, "/v1/proxy/llm/anthropic/v1/messages", { headers: asEngine })).status).toBe(200);
      expect(upstream.last.path).toBe("/v1/proxy/llm/anthropic/v1/messages");
      expect(upstream.last.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
      expect(upstream.last.headers["x-stigmer-execution-id"], "the turn's execution, which the engine never named").toBe(EXECUTION);
      expect(upstream.last.headers["x-api-key"]).toBeUndefined();
      expect(JSON.stringify(upstream.last.headers)).not.toContain(TURN_KEY);
    } finally {
      close();
      await proxy.close();
    }
  });
});

describe("terminate: a runner that calls its providers itself", () => {
  let proxy: AgentProxy;
  let closeTurn: () => void;

  beforeEach(async () => {
    proxy = await startProxy({ proxyEndpoint: null });
    closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
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
    closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
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
    expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint", { method: "GET", headers: asHost })).status, "a read that names no thread").toBe(403);
    expect(upstream.received).toHaveLength(sent);
  });

  it("passes an empty write batch through, as the platform answers it", async () => {
    const res = await call(proxy, "/v1/proxy/checkpoints/writes", { method: "PUT", headers: asHost, body: JSON.stringify({ writes: [] }) });
    expect(res.status).toBe(200);
    expect(upstream.last.path).toBe("/v1/proxy/checkpoints/writes");
    const sent = upstream.received.length;
    expect((await call(proxy, "/v1/proxy/checkpoints/thread", { method: "DELETE", headers: asHost, body: JSON.stringify({ writes: [] }) })).status, "only a write batch").toBe(403);
    expect((await call(proxy, "/v1/proxy/checkpoints/writes", { method: "PUT", headers: asHost, body: "" })).status, "an empty body is no batch").toBe(403);
    expect(upstream.received).toHaveLength(sent);
  });

  it("serves the thread the turn itself names, whatever its shape", async () => {
    const close = proxy.openTurn({ executionId: "run_ephemeral", threadId: "ephemeral-agt-1", turnKey: "turn-key-ephemeral" });
    const asEphemeral = { ...asHost, "x-stigmer-execution-id": "run_ephemeral", "x-stigmer-turn-key": "turn-key-ephemeral" };
    const read = await call(proxy, "/v1/proxy/checkpoints/checkpoint?thread_id=ephemeral-agt-1", { method: "GET", headers: asEphemeral });
    close();
    expect(read.status).toBe(200);
    expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint?thread_id=ephemeral-agt-1", { method: "GET", headers: asEphemeral })).status, "once the turn has settled").toBe(403);
  });

  it("serves the host's own checkpoint saver the turn's thread under the turn's key, and refuses it without one", async () => {
    const saver = new HttpCheckpointSaver(proxy.endpoint, { current: HOST_TOKEN }, { maxRetries: 0 });
    const config = { configurable: { thread_id: THREAD, checkpoint_ns: "" } };
    upstream.answer = { status: 404, headers: {}, body: "" };
    const sent = upstream.received.length;

    await expect(runWithExecutionContext(EXECUTION, () => saver.getTuple(config), TURN_KEY)).resolves.toBeUndefined();
    expect(upstream.received).toHaveLength(sent + 1);
    expect(upstream.last.path).toBe(`/v1/proxy/checkpoints/checkpoint?thread_id=${THREAD}&checkpoint_ns=`);

    await expect(runWithExecutionContext(EXECUTION, () => saver.getTuple(config)), "no key in the turn's context").rejects.toThrow(/403/);
    expect(upstream.received, "nothing reaches the platform").toHaveLength(sent + 1);
  });

  it("lets a turn's key reach only that turn's own thread", async () => {
    const close = proxy.openTurn({ executionId: "run_other", threadId: "thread-ses-other", turnKey: "turn-key-other" });
    try {
      expect((await call(proxy, "/v1/proxy/checkpoints/checkpoint?thread_id=thread-ses-other", { method: "GET", headers: asHost })).status, "another live turn's thread").toBe(403);
      expect((await call(proxy, `/v1/proxy/checkpoints/checkpoint?thread_id=${THREAD}`, { method: "GET", headers: { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION } })).status, "no key").toBe(403);
    } finally {
      close();
    }
  });
});

describe("the engine-sessions lane: a turn's transcript store reaches its own thread only", () => {
  const LANE = "/v1/proxy/engine-sessions";
  const OTHER_THREAD = "thread-ses-other";
  let proxy: AgentProxy;
  let closeTurn: () => void;

  beforeEach(async () => {
    // An earlier block can leave the upstream answering something else.
    upstream.answer = FakeUpstream.DEFAULT_ANSWER;
    proxy = await startProxy({ proxyEndpoint: upstream.url, checkpointerType: "http", checkpointerProxyEndpoint: upstream.url });
    closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
  });
  afterEach(async () => {
    closeTurn();
    await proxy.close();
  });

  /** What reached the platform carries the runner's token and nothing of the host's or the turn's. */
  function expectRunnerCredentialOnly(headers: IncomingHttpHeaders): void {
    expect(headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
    expect(headers["x-api-key"]).toBeUndefined();
    expect(Object.keys(headers).filter((h) => h.startsWith("x-stigmer-")), "no scope header, the turn key included").toEqual([]);
    const sent = JSON.stringify(headers);
    expect(sent).not.toContain(HOST_TOKEN);
    expect(sent).not.toContain(TURN_KEY);
  }

  it("forwards the live turn's own thread to the platform's lane with the runner's token, by query and by body", async () => {
    const read = await call(proxy, `${LANE}/entries?thread_id=${THREAD}&subpath=`, { method: "GET", headers: asHost });
    expect(read.status).toBe(200);
    expect(upstream.last.method).toBe("GET");
    expect(upstream.last.path).toBe(`${LANE}/entries?thread_id=${THREAD}&subpath=`);
    expectRunnerCredentialOnly(upstream.last.headers);

    const body = JSON.stringify({ thread_id: THREAD, subpath: "", entries: [{ type: "user", uuid: "u1" }] });
    const write = await call(proxy, `${LANE}/entries`, { headers: asHost, body });
    expect(write.status).toBe(200);
    expect(upstream.last.method).toBe("POST");
    expect(upstream.last.path).toBe(`${LANE}/entries`);
    expect(upstream.last.body, "the bytes unchanged").toBe(body);
    expectRunnerCredentialOnly(upstream.last.headers);

    expect((await call(proxy, `${LANE}/subkeys?thread_id=${THREAD}`, { method: "GET", headers: asHost })).status).toBe(200);
    expect((await call(proxy, `${LANE}/entries?thread_id=${THREAD}`, { method: "DELETE", headers: asHost })).status).toBe(200);
    expect(upstream.last.method).toBe("DELETE");
    expect(upstream.last.path).toBe(`${LANE}/entries?thread_id=${THREAD}`);
    expectRunnerCredentialOnly(upstream.last.headers);
  });

  it("refuses another thread, a live turn's included, in the query or in the body", async () => {
    const closeOther = proxy.openTurn({ executionId: "run_other", threadId: OTHER_THREAD, turnKey: "turn-key-other" });
    try {
      const sent = upstream.received.length;
      const read = await call(proxy, `${LANE}/entries?thread_id=${OTHER_THREAD}&subpath=`, { method: "GET", headers: asHost });
      expect(read.status, "another live turn's thread, read").toBe(403);
      expect(((await read.json()) as { error: { message: string } }).error.message).toBe(`thread ${OTHER_THREAD} is not the turn's own`);
      expect((await call(proxy, `${LANE}/subkeys?thread_id=${OTHER_THREAD}`, { method: "GET", headers: asHost })).status, "listed").toBe(403);
      expect((await call(proxy, `${LANE}/entries?thread_id=${OTHER_THREAD}`, { method: "DELETE", headers: asHost })).status, "deleted").toBe(403);
      const intrusion = JSON.stringify({ thread_id: OTHER_THREAD, subpath: "", entries: [{ type: "user", uuid: "u1" }] });
      expect((await call(proxy, `${LANE}/entries`, { headers: asHost, body: intrusion })).status, "written").toBe(403);
      expect((await call(proxy, `${LANE}/entries?thread_id=${THREAD}`, { headers: asHost, body: intrusion })).status, "written, with the own thread in the query").toBe(403);
      expect((await call(proxy, `${LANE}/entries`, { headers: asHost, body: JSON.stringify({ thread_id: 7, entries: [] }) })).status, "a thread that is not a string").toBe(403);
      expect((await call(proxy, `${LANE}/entries`, { method: "GET", headers: asHost })).status, "a call that names no thread").toBe(403);
      expect((await call(proxy, `${LANE}/entries`, { headers: asHost, body: "not json" })).status, "a body that is not JSON").toBe(400);
      expect(upstream.received, "nothing reached the platform").toHaveLength(sent);
    } finally {
      closeOther();
    }
  });

  it("refuses a call without its turn's key, or with a key no live turn holds", async () => {
    const sent = upstream.received.length;
    expect((await call(proxy, `${LANE}/entries?thread_id=${THREAD}`, { method: "GET", headers: { authorization: `Bearer ${HOST_TOKEN}` } })).status, "no key").toBe(403);
    expect((await call(proxy, `${LANE}/entries?thread_id=${THREAD}`, { method: "GET", headers: { ...asHost, "x-stigmer-turn-key": "turn-key-forged" } })).status, "a forged key").toBe(403);
    expect((await call(proxy, `${LANE}/entries?thread_id=${THREAD}`, { method: "GET", headers: { "x-api-key": TURN_KEY } })).status, "the turn's key as the credential").toBe(401);
    expect(upstream.received).toHaveLength(sent);
  });

  it("refuses the turn's own thread once the turn has settled", async () => {
    const close = proxy.openTurn({ executionId: "run_settling", threadId: "thread-ses-settling", turnKey: "turn-key-settling" });
    const asSettling = { ...asHost, "x-stigmer-execution-id": "run_settling", "x-stigmer-turn-key": "turn-key-settling" };
    const path = `${LANE}/entries?thread_id=thread-ses-settling&subpath=`;
    expect((await call(proxy, path, { method: "GET", headers: asSettling })).status, "while live").toBe(200);
    const sent = upstream.received.length;
    close();
    const settled = await call(proxy, path, { method: "GET", headers: asSettling });
    expect(settled.status, "settled").toBe(403);
    expect(((await settled.json()) as { error: { message: string } }).error.message).toBe("the turn key names no turn running on this runner");
    expect(upstream.received).toHaveLength(sent);
  });

  it("serves the host's own transcript store the turn's thread under the turn's key, and refuses it without one", async () => {
    const store = new HttpTranscripts(proxy.endpoint, { current: HOST_TOKEN }, { maxRetries: 0 });
    upstream.answer = { status: 404, headers: {}, body: "" };
    try {
      const sent = upstream.received.length;
      await expect(runWithExecutionContext(EXECUTION, () => store.load(THREAD, undefined), TURN_KEY)).resolves.toBeNull();
      expect(upstream.received).toHaveLength(sent + 1);
      expect(upstream.last.path).toBe(`${LANE}/entries?thread_id=${THREAD}&subpath=`);
      expectRunnerCredentialOnly(upstream.last.headers);

      await expect(runWithExecutionContext(EXECUTION, () => store.load(THREAD, undefined)), "no key in the turn's context").rejects.toThrow(/403/);
      await expect(runWithExecutionContext(EXECUTION, () => store.load(OTHER_THREAD, undefined), TURN_KEY), "another thread").rejects.toThrow(/403/);
      expect(upstream.received, "nothing more reaches the platform").toHaveLength(sent + 1);
    } finally {
      upstream.answer = FakeUpstream.DEFAULT_ANSWER;
    }
  });

  it("is not served on a runner that keeps an engine's conversation locally", async () => {
    const local = await startProxy({ proxyEndpoint: upstream.url, checkpointerType: "sqlite", checkpointerProxyEndpoint: null });
    const close = local.openTurn({ executionId: EXECUTION, threadId: THREAD, turnKey: TURN_KEY });
    try {
      const res = await call(local, `${LANE}/entries?thread_id=${THREAD}&subpath=`, { method: "GET", headers: asHost });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
        "the engine-sessions lane is not served: this runner keeps an engine's conversation locally",
      );
    } finally {
      close();
      await local.close();
    }
  });
});
