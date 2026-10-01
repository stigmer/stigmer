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
import { DEFAULT_REPLY_TEXT, FakeLlmUpstream, type FakeLlmUpstreamOptions } from "../fake-llm-upstream.ts";

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
