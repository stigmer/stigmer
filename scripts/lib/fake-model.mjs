/**
 * The install journeys' model: a fake Anthropic Messages API that every
 * self-host smoke points a real install at, so an agent run completes
 * end to end with no key, no network and no cost. The install is configured
 * the way a user configures it (ANTHROPIC_API_KEY plus ANTHROPIC_BASE_URL);
 * only the model on the far side is fake.
 *
 * Plain node, no dependencies, like its neighbour stigmer-smoke.mjs: the
 * release runs the smokes straight after a checkout, with no install, so
 * nothing here may import a package or TypeScript. That is why this is a copy
 * and not an import of the conformance harness's FakeLlmUpstream
 * (test/conformance/src/harness/fake-llm-upstream.ts). The copy is bounded on
 * purpose: one provider, one canned reply, one error. The reply text is the
 * harness's own DEFAULT_REPLY_TEXT, and fake-model.test.mjs fails when the two
 * drift. The shared test machinery's one home, test/support, is to fold both
 * into a form bare node can load.
 *
 * Modes:
 *   reply  every POST /v1/messages answers one text turn that ends the agent
 *          loop, as SSE when the request streams and JSON otherwise, echoing
 *          the request's model so the caller's routing sees itself.
 *   error  every POST /v1/messages answers a 400 invalid_request_error, which
 *          neither the SDK nor the runner retries, so a smoke run against it
 *          goes red at its agent step with the provider's message instead of
 *          timing out.
 * Any other path answers 404 with a loud body.
 */

import { createServer } from "node:http";

/** The text every reply carries: the conformance fake's, plainly not a real model's answer. */
export const FAKE_MODEL_REPLY_TEXT =
  "This is the Stigmer fake model's default reply; no real model was called.";

/** The provider message the error mode answers with. */
export const FAKE_MODEL_ERROR_MESSAGE = "the install journey's fake model is in error mode";

/**
 * The key an install is handed alongside the fake's address. It only has to
 * be non-empty: the all-in-one entrypoint and the runner treat an empty key
 * as "no model configured", and the fake never reads it.
 */
export const FAKE_MODEL_API_KEY = "sk-ant-install-journey-fake";

const MODES = new Set(["reply", "error"]);

/**
 * The model settings an install is started with to reach `fake`, exactly the
 * two a user sets for a gateway: the key and ANTHROPIC_BASE_URL. `host` is the
 * name the install resolves the machine running the fake by (loopback for
 * `stigmer up`, host.docker.internal for a container or a kind pod).
 */
export function fakeModelEnv(fake, host = "127.0.0.1") {
  return { ANTHROPIC_API_KEY: FAKE_MODEL_API_KEY, ANTHROPIC_BASE_URL: `http://${host}:${fake.port}` };
}

/**
 * The `--fake-model=<reply|error>` argument every install smoke takes: `error`
 * starts the fake in error mode, the switch that shows the smoke's agent step
 * red first. Returns the mode, or undefined when `arg` is not this flag.
 */
export function parseFakeModelArg(arg) {
  const m = /^--fake-model=(.+)$/.exec(arg);
  if (m === null) return undefined;
  if (!MODES.has(m[1])) throw new Error(`--fake-model must be one of: ${[...MODES].join(", ")} (got ${JSON.stringify(m[1])})`);
  return m[1];
}

/**
 * Start the fake on `host` (loopback by default; `0.0.0.0` when a container
 * reaches it through the host gateway) and an ephemeral port. Resolves
 * `{ url, port, replyText, requests, close }`: `url` is the loopback address,
 * `requests()` the number of model calls answered so far.
 */
export async function startFakeModel({ host = "127.0.0.1", mode = "reply" } = {}) {
  if (!MODES.has(mode)) throw new Error(`fake model: unknown mode ${JSON.stringify(mode)} (reply | error)`);
  let answered = 0;
  const server = createServer((request, response) => {
    readBody(request).then(
      (raw) => {
        const path = new URL(request.url ?? "/", "http://fake").pathname;
        if (request.method !== "POST" || path !== "/v1/messages") {
          writeJson(response, 404, { error: `fake model: unhandled ${request.method} ${path}` });
          return;
        }
        answered += 1;
        if (mode === "error") {
          writeJson(response, 400, {
            type: "error",
            error: { type: "invalid_request_error", message: FAKE_MODEL_ERROR_MESSAGE },
          });
          return;
        }
        const body = parseJson(raw);
        const message = replyMessage(typeof body?.model === "string" && body.model !== "" ? body.model : undefined);
        if (body?.stream === true) writeSse(response, message);
        else writeJson(response, 200, message);
      },
      (error) => writeJson(response, 400, { error: `fake model: unreadable request: ${error.message}` }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    replyText: FAKE_MODEL_REPLY_TEXT,
    requests: () => answered,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      }),
  };
}

/** One Anthropic text turn that ends the agent loop (stop_reason end_turn). */
function replyMessage(model) {
  return {
    id: "msg_fake_install_journey",
    type: "message",
    role: "assistant",
    model: model ?? "claude-sonnet-4-6",
    content: [{ type: "text", text: FAKE_MODEL_REPLY_TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/** The event sequence Anthropic's streaming API sends for one text block. */
function writeSse(response, message) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  event("message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } },
  });
  event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  event("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: FAKE_MODEL_REPLY_TEXT },
  });
  event("content_block_stop", { type: "content_block_stop", index: 0 });
  event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: message.usage.output_tokens },
  });
  event("message_stop", { type: "message_stop" });
  response.end();
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseJson(raw) {
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
