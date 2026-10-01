/**
 * The install journeys' model: test/support's FakeLlmUpstream, the one fake
 * provider every suite shares, started the way an install smoke needs it.
 * Every self-host smoke points a real install at it, so an agent run
 * completes end to end with no key, no network and no cost. The install is
 * configured the way a user configures it (ANTHROPIC_API_KEY plus
 * ANTHROPIC_BASE_URL); only the model on the far side is fake.
 *
 * Plain node, no dependencies, like its neighbour stigmer-smoke.mjs: the
 * release runs the smokes straight after a checkout, with no install. The
 * fake itself is erasable TypeScript that Node's type stripping loads
 * directly, by relative path (test/support's one import rule), so the reply
 * text and the wire are the conformance suites' own. What lives here is only
 * what the install journeys add: the key, the `--fake-model` flag, and the
 * model settings an install is started with.
 *
 * Modes:
 *   reply  every unscripted model call answers one text turn that ends the
 *          agent loop, as SSE when the request streams and JSON otherwise,
 *          echoing the request's model so the caller's routing sees itself
 *          (FakeLlmUpstream's default-reply mode).
 *   error  every unscripted model call answers a 400 invalid_request_error,
 *          which neither the SDK nor the runner retries, so a smoke run
 *          against it goes red at its agent step with the provider's message
 *          instead of timing out (its default-error mode).
 * Any path that is no provider's answers 404 with a loud body.
 *
 * The one journey that swaps the far side for the real provider is the CLI
 * smoke's `--live-model` (the live lane, after a release): `liveModelEnv`
 * hands the install the user's own ANTHROPIC_API_KEY and no base URL, so it
 * reaches Anthropic itself, and the agent runs on `LIVE_MODEL`. Everything
 * else in that journey is the fake-model one.
 */

import { DEFAULT_REPLY_TEXT, FakeLlmUpstream } from "../../support/src/fake-llm-upstream.ts";

/** The text every reply carries: the shared fake's, plainly not a real model's answer. */
export const FAKE_MODEL_REPLY_TEXT = DEFAULT_REPLY_TEXT;

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

/** The model a `--live-model` run pins: the cheapest native model in the registry. */
export const LIVE_MODEL = "claude-haiku-4.5";

/**
 * The model settings an install is started with for a `--live-model` run: the
 * key from `env` (the shell's ANTHROPIC_API_KEY) and ANTHROPIC_BASE_URL set
 * blank, so the install talks to Anthropic itself even when the shell exports
 * a gateway (the install's environment is the shell's with these laid over
 * it, and the runner reads a blank base URL as Anthropic's own). Throws when
 * the key is missing, naming the variable and never a value.
 */
export function liveModelEnv(env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("--live-model needs ANTHROPIC_API_KEY in the environment (the run calls the real provider and spends money)");
  return { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: "" };
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
  const fake = new FakeLlmUpstream(
    mode === "reply" ? { host, defaultReply: true } : { host, defaultError: { message: FAKE_MODEL_ERROR_MESSAGE } },
  );
  await fake.start();
  return {
    url: fake.url(),
    port: fake.port(),
    replyText: FAKE_MODEL_REPLY_TEXT,
    requests: () => fake.requests().filter((request) => request.provider !== "unknown").length,
    close: () => fake.close(),
  };
}
