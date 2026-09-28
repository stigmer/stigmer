// Unit arms for the cloud-capability fixtures: the three fakes' wire behavior
// and the control API round-trip through the typed client. Pure loopback —
// no target, no launcher.
// Domain: conformance harness (cloud-capability fixtures, E1).
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCloudFixtures, type CloudFixtures } from "../cloud-fixtures";
import { FAKE_CARD, signStripePayload, stripeEvent, STRIPE_JAVA_API_VERSION } from "../fake-stripe";
import { DEFAULT_REPLY_CAPTURE_LIMIT, DEFAULT_REPLY_TEXT } from "../fake-llm-upstream";
import { anthropicText, openAiText } from "../llm-wire";
import { CloudFixturesClient } from "../../support/cloud-fixtures-client";

let fixtures: CloudFixtures;
let control: CloudFixturesClient;

beforeAll(async () => {
  fixtures = await startCloudFixtures();
  control = new CloudFixturesClient(fixtures.addresses.controlUrl);
});

afterAll(async () => {
  await fixtures.stop();
});

async function readSse(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split("\n\n").filter((frame) => frame !== "");
}

describe("fake LLM upstream", () => {
  it("streams a scripted Anthropic turn as SSE when the request asks for a stream, and captures what it received", async () => {
    await control.llm.enqueue({ kind: "anthropic", body: anthropicText("hello", { inputTokens: 42, outputTokens: 7 }) });
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-injected-by-proxy" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const frames = await readSse(response);
    expect(frames[0]).toContain("event: message_start");
    expect(frames.at(-1)).toContain("event: message_stop");
    expect(frames.join("\n")).toContain('"input_tokens":42');
    expect(frames.join("\n")).toContain('"output_tokens":7');

    const requests = await control.llm.requests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.provider).toBe("anthropic");
    expect(requests[0]?.headers["x-api-key"]).toBe("sk-injected-by-proxy");
    await control.llm.reset();
  });

  it("streams an OpenAI turn with the usage chunk `stream_options.include_usage` requests, and omits it when told to", async () => {
    await control.llm.enqueue({ kind: "openai", body: openAiText("hi", { inputTokens: 3, outputTokens: 4 }) });
    await control.llm.enqueue({ kind: "openai", body: openAiText("hi"), includeUsage: false });
    const call = (): Promise<Response> =>
      fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4.1", stream: true, messages: [] }),
      });
    const withUsage = (await readSse(await call())).join("\n");
    expect(withUsage).toContain('"total_tokens":7');
    expect(withUsage.trim().endsWith("data: [DONE]")).toBe(true);
    const withoutUsage = (await readSse(await call())).join("\n");
    expect(withoutUsage).not.toContain("total_tokens");
    await control.llm.reset();
  });

  it("answers a plain JSON body when the request does not stream", async () => {
    await control.llm.enqueue({ kind: "anthropic", body: anthropicText("json") });
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
    });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(((await response.json()) as { content: Array<{ text: string }> }).content[0]?.text).toBe("json");
    await control.llm.reset();
  });

  it("relays a scripted provider error with its status, body and headers", async () => {
    await control.llm.enqueue({
      kind: "error",
      status: 429,
      body: { error: { type: "insufficient_quota", message: "quota" } },
      headers: { "retry-after": "30" },
    });
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    await control.llm.reset();
  });

  it("cuts an Anthropic stream after N events with a destroyed socket", async () => {
    await control.llm.enqueue({ kind: "abort-mid-stream", body: anthropicText("cut"), afterEvents: 2 });
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, {
      method: "POST",
      body: JSON.stringify({ stream: true }),
    });
    // The head arrived (200, a stream) and then the body broke — exactly the
    // upstream-aborted-mid-stream shape the proxy must classify.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(response.text()).rejects.toThrow();
    await control.llm.reset();
  });

  it("refuses an unknown path loudly without consuming the queue", async () => {
    await control.llm.enqueue({ kind: "anthropic", body: anthropicText("kept") });
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/embeddings`, { method: "POST", body: "{}" });
    expect(response.status).toBe(404);
    const kept = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, { method: "POST", body: "{}" });
    expect(kept.status).toBe(200);
    await control.llm.reset();
  });

  it("answers 500 with a legible body when nothing is queued", async () => {
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, { method: "POST", body: "{}" });
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("no queued response");
    await control.llm.reset();
  });
});

describe("fake Stripe API", () => {
  it("mints run-unique ids, echoes metadata, and captures params plus the Idempotency-Key header", async () => {
    const form = new URLSearchParams({
      mode: "payment",
      customer: "cus_x",
      "metadata[stigmer_purchase_id]": "p-1",
      "line_items[0][price_data][unit_amount]": "2000",
    });
    const response = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/checkout/sessions`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": "idem-1" },
      body: form.toString(),
    });
    expect(response.status).toBe(200);
    const session = (await response.json()) as { id: string; object: string; metadata: Record<string, string>; url: string };
    expect(session.id).toMatch(/^cs_test_conf_[0-9a-f]{6}_\d{4}$/);
    expect(session.object).toBe("checkout.session");
    expect(session.metadata["stigmer_purchase_id"]).toBe("p-1");

    const requests = await control.stripe.requests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.idempotencyKey).toBe("idem-1");
    expect(requests[0]?.params["line_items[0][price_data][unit_amount]"]).toBe("2000");
    expect(requests[0]?.response.id).toBe(session.id);
    await control.stripe.reset();
  });

  it("creates, retrieves and updates a customer; unknown customers answer Stripe's resource_missing", async () => {
    const created = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/customers`, {
      method: "POST",
      body: new URLSearchParams({ name: "org-1", "metadata[stigmer_org_id]": "org-1" }).toString(),
    });
    const customer = (await created.json()) as { id: string };
    const updated = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/customers/${customer.id}`, {
      method: "POST",
      body: new URLSearchParams({ "invoice_settings[default_payment_method]": "pm_1" }).toString(),
    });
    expect(((await updated.json()) as { invoice_settings: { default_payment_method: string } }).invoice_settings.default_payment_method).toBe("pm_1");
    const missing = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/customers/cus_nope`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("resource_missing");
    await control.stripe.reset();
  });

  it("answers a payment-method retrieve with the one card it knows, expiry included (the Java customer.updated handler reads exp_month/exp_year unguarded)", async () => {
    const response = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/payment_methods/pm_any`);
    expect(response.status).toBe(200);
    const method = (await response.json()) as { id: string; object: string; type: string; card: typeof FAKE_CARD };
    expect(method.id).toBe("pm_any");
    expect(method.object).toBe("payment_method");
    expect(method.type).toBe("card");
    expect(method.card).toEqual(FAKE_CARD);
    expect(method.card.exp_month).toBeGreaterThan(0);
    expect(method.card.exp_year).toBeGreaterThan(new Date().getFullYear());
    await control.stripe.reset();
  });

  it("fails the next matching call once with a Stripe-shaped error, then recovers", async () => {
    await control.stripe.failNext({ pathPrefix: "/v1/billing_portal", status: 402, code: "card_declined", message: "declined" });
    const failed = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/billing_portal/sessions`, { method: "POST", body: "customer=cus_1" });
    expect(failed.status).toBe(402);
    const ok = await fetch(`${fixtures.addresses.stripeApiUrl}/v1/billing_portal/sessions`, { method: "POST", body: "customer=cus_1" });
    expect(ok.status).toBe(200);
    await control.stripe.reset();
  });

  it("signs payloads exactly as Stripe does (t=..,v1=HMAC-SHA256 over `t.payload`) and stamps the stripe-java pin", () => {
    const event = stripeEvent("checkout.session.completed", { id: "cs_1", object: "checkout.session" }, { id: "evt_1", created: 1_700_000_000 });
    expect(event.api_version).toBe(STRIPE_JAVA_API_VERSION);
    const payload = JSON.stringify(event);
    const signed = signStripePayload(payload, "whsec_test", 1_700_000_100);
    const expected = createHmac("sha256", "whsec_test").update(`1700000100.${payload}`).digest("hex");
    expect(signed.signature).toBe(`t=1700000100,v1=${expected}`);
  });
});

describe("fake Discord webhook", () => {
  it("captures the embed body, answers 204, and fails the next delivery when told to", async () => {
    const post = (): Promise<Response> =>
      fetch(fixtures.addresses.discordWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ embeds: [{ title: "New contact-sales lead" }] }),
      });
    expect((await post()).status).toBe(204);
    await control.discord.failNext(500);
    expect((await post()).status).toBe(500);
    expect((await post()).status).toBe(204);
    const posts = await control.discord.posts();
    expect(posts).toHaveLength(3);
    expect((posts[0]?.body as { embeds: Array<{ title: string }> }).embeds[0]?.title).toBe("New contact-sales lead");
    await control.discord.reset();
    expect(await control.discord.posts()).toEqual([]);
  });
});

describe("control API", () => {
  it("resets every fake at once and refuses unknown verbs", async () => {
    await control.llm.enqueue({ kind: "anthropic", body: anthropicText("x") });
    await control.resetAll();
    const response = await fetch(`${fixtures.addresses.llmUpstreamUrl}/v1/messages`, { method: "POST", body: "{}" });
    expect(response.status).toBe(500);
    const unknown = await fetch(`${fixtures.addresses.controlUrl}/nope`);
    expect(unknown.status).toBe(404);
  });
});

// Default-reply mode (stigmer/stigmer#1402) belongs to a local development
// stack, so it gets its own fixtures instance: the shared one above stays in
// the suites' strict mode, where an unscripted call is a 500.
describe("fake LLM upstream in default-reply mode", () => {
  let lenient: CloudFixtures;
  let lenientControl: CloudFixturesClient;

  beforeAll(async () => {
    lenient = await startCloudFixtures({ llmDefaultReply: true });
    lenientControl = new CloudFixturesClient(lenient.addresses.controlUrl);
  });

  afterAll(async () => {
    await lenient.stop();
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${lenient.addresses.llmUpstreamUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers an unscripted Anthropic call with the canned turn, streamed when asked, echoing the request's model", async () => {
    const streamed = await post("/v1/messages", { model: "claude-opus-4-1", stream: true, messages: [] });
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-type")).toBe("text/event-stream");
    const frames = await readSse(streamed);
    expect(frames.join("\n")).toContain(DEFAULT_REPLY_TEXT);
    expect(frames.join("\n")).toContain('"model":"claude-opus-4-1"');
    expect(frames.at(-1)).toContain("event: message_stop");

    const plain = await post("/v1/messages", { model: "claude-opus-4-1", messages: [] });
    expect(plain.status).toBe(200);
    const body = (await plain.json()) as { model: string; stop_reason: string; content: Array<{ text: string }> };
    expect(body.model).toBe("claude-opus-4-1");
    expect(body.stop_reason).toBe("end_turn");
    expect(body.content[0]?.text).toBe(DEFAULT_REPLY_TEXT);
    await lenientControl.llm.reset();
  });

  it("answers an unscripted OpenAI call with the canned completion, streamed when asked", async () => {
    const streamed = await post("/v1/chat/completions", { model: "gpt-5", stream: true, messages: [] });
    expect(streamed.status).toBe(200);
    const frames = await readSse(streamed);
    expect(frames.join("\n")).toContain(DEFAULT_REPLY_TEXT);
    expect(frames.at(-1)).toBe("data: [DONE]");

    const plain = await post("/v1/chat/completions", { model: "gpt-5", messages: [] });
    const body = (await plain.json()) as { model: string; choices: Array<{ message: { content: string } }> };
    expect(body.model).toBe("gpt-5");
    expect(body.choices[0]?.message.content).toBe(DEFAULT_REPLY_TEXT);
    await lenientControl.llm.reset();
  });

  it("still serves a scripted entry first, and keeps the mode across a reset", async () => {
    await lenientControl.llm.enqueue({ kind: "anthropic", body: anthropicText("scripted") });
    const first = (await (await post("/v1/messages", { model: "m", messages: [] })).json()) as { content: Array<{ text: string }> };
    expect(first.content[0]?.text).toBe("scripted");
    const second = (await (await post("/v1/messages", { model: "m", messages: [] })).json()) as { content: Array<{ text: string }> };
    expect(second.content[0]?.text).toBe(DEFAULT_REPLY_TEXT);

    await lenientControl.llm.reset();
    const afterReset = await post("/v1/messages", { model: "m", messages: [] });
    expect(afterReset.status).toBe(200);
    expect(await lenientControl.llm.requests()).toHaveLength(1);
    await lenientControl.llm.reset();
  });

  it("keeps only the most recent requests in its capture log", async () => {
    const total = DEFAULT_REPLY_CAPTURE_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      await post("/v1/messages", { model: `m-${i}`, messages: [] });
    }
    const requests = await lenientControl.llm.requests();
    expect(requests).toHaveLength(DEFAULT_REPLY_CAPTURE_LIMIT);
    expect((requests.at(-1)?.body as { model: string }).model).toBe(`m-${total - 1}`);
    await lenientControl.llm.reset();
  });
});
