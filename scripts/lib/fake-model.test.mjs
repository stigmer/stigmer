// Pins the install journeys' fake model (fake-model.mjs) on the wire a real
// Anthropic client reads: one text turn as JSON and as the SSE event sequence,
// the request's model echoed back, a 400 in error mode, a 404 off the
// Messages path. One test reads the conformance harness's fake as text and
// fails when its reply drifts from this copy's, since the two are one reply
// in two forms until test/support holds both. Run via `npm run test:scripts`
// (node --test; wired into the root `npm test`).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FAKE_MODEL_ERROR_MESSAGE, FAKE_MODEL_REPLY_TEXT, startFakeModel } from "./fake-model.mjs";

async function withFake(options, body) {
  const fake = await startFakeModel(options);
  try {
    await body(fake);
  } finally {
    await fake.close();
  }
}

function postMessages(url, payload) {
  return fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "journey" },
    body: JSON.stringify(payload),
  });
}

test("answers a non-streaming request with one end_turn text turn, echoing the model", async () => {
  await withFake({}, async (fake) => {
    const response = await postMessages(fake.url, { model: "claude-haiku-4-5-20251001", max_tokens: 16, messages: [] });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const message = await response.json();
    assert.equal(message.model, "claude-haiku-4-5-20251001");
    assert.equal(message.stop_reason, "end_turn");
    assert.deepEqual(message.content, [{ type: "text", text: FAKE_MODEL_REPLY_TEXT }]);
    assert.equal(fake.requests(), 1);
  });
});

test("streams the same turn as Anthropic's SSE event sequence", async () => {
  await withFake({}, async (fake) => {
    const response = await postMessages(fake.url, { model: "claude-sonnet-4-6", stream: true, messages: [] });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const frames = (await response.text())
      .split("\n\n")
      .filter((frame) => frame !== "")
      .map((frame) => {
        const [eventLine, dataLine] = frame.split("\n");
        return { event: eventLine.replace(/^event: /, ""), data: JSON.parse(dataLine.replace(/^data: /, "")) };
      });
    assert.deepEqual(
      frames.map((frame) => frame.event),
      ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"],
    );
    assert.equal(frames[0].data.message.model, "claude-sonnet-4-6");
    assert.equal(frames[2].data.delta.text, FAKE_MODEL_REPLY_TEXT);
    assert.equal(frames[4].data.delta.stop_reason, "end_turn");
  });
});

test("answers every Messages request with a non-retryable 400 in error mode", async () => {
  await withFake({ mode: "error" }, async (fake) => {
    const response = await postMessages(fake.url, { model: "claude-sonnet-4-6", stream: true, messages: [] });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      type: "error",
      error: { type: "invalid_request_error", message: FAKE_MODEL_ERROR_MESSAGE },
    });
  });
});

test("refuses any other path loudly, without counting it as a model call", async () => {
  await withFake({}, async (fake) => {
    const response = await fetch(`${fake.url}/v1/chat/completions`, { method: "POST", body: "{}" });
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /unhandled POST \/v1\/chat\/completions/);
    assert.equal(fake.requests(), 0);
  });
});

test("refuses an unknown mode instead of starting", async () => {
  await assert.rejects(startFakeModel({ mode: "silent" }), /unknown mode "silent"/);
});

test("carries the conformance harness's reply text, so the two fakes answer alike", () => {
  const harness = readFileSync(
    new URL("../../test/conformance/src/harness/fake-llm-upstream.ts", import.meta.url),
    "utf8",
  );
  const declared = /export const DEFAULT_REPLY_TEXT = "([^"]+)";/.exec(harness);
  assert.ok(declared, "fake-llm-upstream.ts no longer declares DEFAULT_REPLY_TEXT as a string literal");
  assert.equal(FAKE_MODEL_REPLY_TEXT, declared[1]);
});
