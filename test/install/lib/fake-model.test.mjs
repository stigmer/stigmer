// Pins what the install journeys add to test/support's fake model
// (fake-model.mjs): the fake starts under bare node by relative path, in the
// mode the `--fake-model` flag names, and an install is handed exactly the
// key and the base URL a user sets. The fake's own wire (the reply as JSON
// and SSE, the error mode, the 404) is pinned with the fake, in
// test/support/src/__tests__/fake-llm-upstream.test.ts. Run via
// `npm run test:scripts` (node --test; wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FAKE_MODEL_API_KEY,
  FAKE_MODEL_ERROR_MESSAGE,
  FAKE_MODEL_REPLY_TEXT,
  fakeModelEnv,
  parseFakeModelArg,
  startFakeModel,
} from "./fake-model.mjs";

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
    headers: { "content-type": "application/json", "x-api-key": FAKE_MODEL_API_KEY },
    body: JSON.stringify(payload),
  });
}

test("starts test/support's fake under bare node, answering with its reply and counting the call", async () => {
  await withFake({}, async (fake) => {
    assert.equal(fake.url, `http://127.0.0.1:${fake.port}`);
    const message = await (await postMessages(fake.url, { model: "claude-sonnet-4-6", messages: [] })).json();
    assert.deepEqual(message.content, [{ type: "text", text: FAKE_MODEL_REPLY_TEXT }]);
    assert.equal(fake.replyText, FAKE_MODEL_REPLY_TEXT);
    assert.equal(fake.requests(), 1);
  });
});

test("counts only model calls: a request off every provider path is refused and not counted", async () => {
  await withFake({}, async (fake) => {
    const response = await fetch(`${fake.url}/v1/embeddings`, { method: "POST", body: "{}" });
    assert.equal(response.status, 404);
    assert.equal(fake.requests(), 0);
  });
});

test("error mode answers with the install journey's message", async () => {
  await withFake({ mode: "error" }, async (fake) => {
    const response = await postMessages(fake.url, { model: "claude-sonnet-4-6", messages: [] });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.message, FAKE_MODEL_ERROR_MESSAGE);
  });
});

test("refuses an unknown mode instead of starting", async () => {
  await assert.rejects(startFakeModel({ mode: "silent" }), /unknown mode "silent"/);
});

test("hands an install the key and the base URL a user sets, by the host it resolves", () => {
  assert.deepEqual(fakeModelEnv({ port: 4242 }, "host.docker.internal"), {
    ANTHROPIC_API_KEY: FAKE_MODEL_API_KEY,
    ANTHROPIC_BASE_URL: "http://host.docker.internal:4242",
  });
  assert.equal(fakeModelEnv({ port: 4242 }).ANTHROPIC_BASE_URL, "http://127.0.0.1:4242");
});

test("reads the --fake-model flag, refusing a mode it does not know", () => {
  assert.equal(parseFakeModelArg("--fake-model=error"), "error");
  assert.equal(parseFakeModelArg("--fake-model=reply"), "reply");
  assert.equal(parseFakeModelArg("--build"), undefined);
  assert.throws(() => parseFakeModelArg("--fake-model=silent"), /--fake-model must be one of: reply, error/);
});
