// Unit arms for the fake LLM provider in the two modes the install journeys
// start it in: default-reply (one text turn on the wire a real Anthropic
// client reads, as JSON and as the SSE event sequence, the request's model
// echoed back) and default-error (a non-retryable 400 in the provider's
// shape), with a loud 404 off every provider path. The first four cases are
// the install fake's own, carried over title for title when it folded into
// this one. Driven over loopback; no target.
// Domain: test support (model fakes).
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REPLY_TEXT,
  FAKE_REJECTED_KEY,
  FAKE_UNANSWERED_KEY,
  FakeLlmUpstream,
  type FakeLlmUpstreamOptions,
} from "../fake-llm-upstream.ts";
import { anthropicText, mockThoughtSignature } from "../llm-wire.ts";

const ERROR_MESSAGE = "the fake is in error mode";

let fake: FakeLlmUpstream | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function started(options: FakeLlmUpstreamOptions): Promise<FakeLlmUpstream> {
  fake = new FakeLlmUpstream(options);
  await fake.start();
  return fake;
}

function post(upstream: FakeLlmUpstream, path: string, payload: unknown): Promise<Response> {
  return fetch(`${upstream.url()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "journey" },
    body: JSON.stringify(payload),
  });
}

/** Model calls the fake answered: every captured request on a provider's path. */
function modelCalls(upstream: FakeLlmUpstream): number {
  return upstream.requests().filter((request) => request.provider !== "unknown").length;
}

describe("FakeLlmUpstream in the install journeys' modes", () => {
  it("answers a non-streaming request with one end_turn text turn, echoing the model", async () => {
    const upstream = await started({ defaultReply: true });
    const response = await post(upstream, "/v1/messages", { model: "claude-haiku-4-5-20251001", max_tokens: 16, messages: [] });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/application\/json/);
    const message = (await response.json()) as { model: string; stop_reason: string; content: unknown };
    expect(message.model).toBe("claude-haiku-4-5-20251001");
    expect(message.stop_reason).toBe("end_turn");
    expect(message.content).toEqual([{ type: "text", text: DEFAULT_REPLY_TEXT }]);
    expect(modelCalls(upstream)).toBe(1);
  });

  it("answers with the words it is given, on either provider's path", async () => {
    const upstream = await started({ defaultReply: true, defaultReplyText: "Line 3 does not match." });
    const anthropic = (await (await post(upstream, "/v1/messages", { model: "m", max_tokens: 16, messages: [] })).json()) as { content: unknown };
    expect(anthropic.content).toEqual([{ type: "text", text: "Line 3 does not match." }]);
    const openai = (await (await post(upstream, "/v1/chat/completions", { model: "m", messages: [] })).json()) as {
      choices: { message: { content: string } }[];
    };
    expect(openai.choices[0]?.message.content).toBe("Line 3 does not match.");
  });

  it("streams the same turn as Anthropic's SSE event sequence", async () => {
    const upstream = await started({ defaultReply: true });
    const response = await post(upstream, "/v1/messages", { model: "claude-sonnet-4-6", stream: true, messages: [] });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
    const frames = (await response.text())
      .split("\n\n")
      .filter((frame) => frame !== "")
      .map((frame) => {
        const [eventLine = "", dataLine = ""] = frame.split("\n");
        return { event: eventLine.replace(/^event: /, ""), data: JSON.parse(dataLine.replace(/^data: /, "")) as Record<string, unknown> };
      });
    expect(frames.map((frame) => frame.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(frames[0]?.data).toMatchObject({ message: { model: "claude-sonnet-4-6" } });
    expect(frames[2]?.data).toMatchObject({ delta: { text: DEFAULT_REPLY_TEXT } });
    expect(frames[4]?.data).toMatchObject({ delta: { stop_reason: "end_turn" } });
  });

  it("answers every Messages request with a non-retryable 400 in error mode", async () => {
    const upstream = await started({ defaultError: { message: ERROR_MESSAGE } });
    const response = await post(upstream, "/v1/messages", { model: "claude-sonnet-4-6", stream: true, messages: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ type: "error", error: { type: "invalid_request_error", message: ERROR_MESSAGE } });
  });

  it("refuses any other path loudly, without counting it as a model call", async () => {
    const upstream = await started({ defaultReply: true });
    const response = await post(upstream, "/v1/embeddings", {});
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toMatch(/unhandled path \/v1\/embeddings/);
    expect(modelCalls(upstream)).toBe(0);
  });

  it("answers a key save's model listing with an empty list, capturing nothing", async () => {
    const upstream = await started({ defaultError: { message: ERROR_MESSAGE } });
    const response = await fetch(`${upstream.url()}/v1/models`, { headers: { "x-api-key": "sk-ant-check" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: [] });
    expect(upstream.requests()).toEqual([]);
  });

  it("refuses the rejected key's check with 401 and leaves the unanswered key's with 503, by either header", async () => {
    const upstream = await started({ defaultReply: true });
    const rejected = await fetch(`${upstream.url()}/v1/models`, { headers: { "x-api-key": FAKE_REJECTED_KEY } });
    expect(rejected.status).toBe(401);
    const bearer = await fetch(`${upstream.url()}/v1/models`, { headers: { authorization: `Bearer ${FAKE_REJECTED_KEY}` } });
    expect(bearer.status).toBe(401);
    const unanswered = await fetch(`${upstream.url()}/v1/models`, { headers: { "x-api-key": FAKE_UNANSWERED_KEY } });
    expect(unanswered.status).toBe(503);
    const other = await fetch(`${upstream.url()}/v1/models`, { headers: { authorization: "Bearer sk-ant-anything-else" } });
    expect(other.status).toBe(200);
    expect(upstream.requests()).toEqual([]);
  });

  it("answers an OpenAI call in error mode with OpenAI's error shape", async () => {
    const upstream = await started({ defaultError: { message: ERROR_MESSAGE } });
    const response = await post(upstream, "/v1/chat/completions", { model: "gpt-5", messages: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { type: "invalid_request_error", message: ERROR_MESSAGE } });
  });

  it("still serves a scripted entry first in error mode", async () => {
    const upstream = await started({ defaultError: { message: ERROR_MESSAGE } });
    upstream.enqueue({ kind: "error", status: 529, body: { type: "error", error: { type: "overloaded_error", message: "scripted" } } });
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(529);
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(400);
  });

  it("serves each request the first queued entry that accepts it, whatever order the requests arrive in", async () => {
    const upstream = await started({ defaultReply: true });
    const isTitle = (request: { readonly body: unknown }): boolean =>
      JSON.stringify((request.body as { system?: unknown }).system ?? "").includes("title generator");
    const turn = { kind: "error", status: 529, body: { error: "the turn's" } } as const;
    upstream.enqueue({ kind: "error", status: 418, body: { error: "the title's" }, matches: isTitle });
    upstream.enqueue({ ...turn, matches: (request) => !isTitle(request) });
    // The turn's call arrives first and skips the title's entry ahead of it.
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(529);
    expect((await post(upstream, "/v1/messages", { model: "m", system: "You are a title generator.", messages: [] })).status).toBe(418);
    // Nothing queued accepts a third call: the mode's default answers it.
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(200);
  });

  it("keeps a standing answer queued for every request it accepts, ahead of the entries behind it", async () => {
    const upstream = await started({ defaultReply: true });
    const forReconciler = (request: { readonly body: unknown }): boolean => JSON.stringify(request.body).includes("reconcile");
    upstream.enqueue({ kind: "error", status: 400, body: { error: "standing" }, matches: forReconciler, repeat: true });
    upstream.enqueue({ kind: "error", status: 529, body: { error: "once" } });
    for (let i = 0; i < 3; i++) {
      expect((await post(upstream, "/v1/messages", { model: "m", system: "You reconcile.", messages: [] })).status).toBe(400);
    }
    // A request it does not accept takes the one-shot entry, then the mode's default.
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(529);
    expect((await post(upstream, "/v1/messages", { model: "m", messages: [] })).status).toBe(200);
    expect((await post(upstream, "/v1/messages", { model: "m", system: "You reconcile.", messages: [] })).status).toBe(400);
  });

  it("listens on the host it is given, and reports its port for another host name", async () => {
    const upstream = await started({ defaultReply: true, host: "0.0.0.0" });
    expect(upstream.url()).toBe(`http://127.0.0.1:${upstream.port()}`);
    const response = await fetch(`http://localhost:${upstream.port()}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [] }),
    });
    expect(response.status).toBe(200);
  });

  it("survives a client that aborts mid-request, and answers the next one", async () => {
    const upstream = await started({ defaultReply: true });
    await new Promise<void>((resolve) => {
      const aborted = request(`${upstream.url()}/v1/messages`, { method: "POST", headers: { "content-length": "1000" } });
      aborted.on("error", () => resolve());
      aborted.write('{"model":');
      setTimeout(() => aborted.destroy(), 50);
    });
    const response = await post(upstream, "/v1/messages", { model: "m", messages: [] });
    expect(response.status).toBe(200);
  });

  it("refuses to be told both to reply and to fail", () => {
    expect(() => new FakeLlmUpstream({ defaultReply: true, defaultError: { message: ERROR_MESSAGE } })).toThrow(
      "defaultReply and defaultError exclude each other",
    );
  });
});

describe("FakeLlmUpstream on Google's Gemini API", () => {
  const STREAM = "/v1beta/models/gemini-3-flash:streamGenerateContent?alt=sse";
  const WHOLE = "/v1beta/models/gemini-3-flash:generateContent";
  const ASK = { contents: [{ role: "user", parts: [{ text: "Hello" }] }] };

  it("answers a scripted Google turn, whole or streamed by the method", async () => {
    const upstream = await started({});
    upstream.enqueue({ kind: "google", body: anthropicText("whole") }).enqueue({ kind: "google", body: anthropicText("streamed") });

    const whole = (await (await post(upstream, WHOLE, ASK)).json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const streamed = await (await post(upstream, STREAM, ASK)).text();

    expect(whole.candidates[0]?.content.parts[0]?.text).toBe("whole");
    expect(streamed).toContain('"text":"streamed"');
    expect(upstream.requests().map((r) => r.provider)).toEqual(["google", "google"]);
  });

  it("refuses an unsigned function call as Google does, without taking a queued answer", async () => {
    const upstream = await started({});
    upstream.enqueue({ kind: "google", body: anthropicText("kept") });
    const unsigned = { contents: [...ASK.contents, { role: "model", parts: [{ functionCall: { name: "f", args: {} } }] }] };
    const signed = { contents: [...ASK.contents, { role: "model", parts: [{ functionCall: { name: "f", args: {} }, thoughtSignature: mockThoughtSignature("c") }] }] };

    expect((await post(upstream, WHOLE, unsigned)).status).toBe(400);
    expect((await post(upstream, WHOLE, signed)).status).toBe(200);
  });

  it("answers in Google's shape in default-reply and default-error modes", async () => {
    const replying = await started({ defaultReply: true });
    const reply = (await (await post(replying, WHOLE, ASK)).json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    expect(reply.candidates[0]?.content.parts[0]?.text).toBe(DEFAULT_REPLY_TEXT);
    await replying.close();

    const failing = await started({ defaultError: { message: ERROR_MESSAGE } });
    const refused = await post(failing, WHOLE, ASK);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: { code: 400, status: "INVALID_ARGUMENT", message: ERROR_MESSAGE } });
  });

  it("answers no other path of Google's API", async () => {
    const upstream = await started({ defaultReply: true });

    expect((await post(upstream, "/v1beta/models/gemini-3-flash:embedContent", ASK)).status).toBe(404);
  });
});
