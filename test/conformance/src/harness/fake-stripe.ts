// A hermetic fake of the two Stripe surfaces the billing engine touches.
// Domain: conformance harness (cloud-capability fixtures, E1).
//
// Outbound: the server under test is booted with its Stripe API base pointed
// at this fixture, so the purchase money path — customer create, checkout
// session create, billing-portal session create, the auto-recharge
// PaymentIntent create, the default-payment-method reads and customer updates
// the webhook handlers make — lands here instead of api.stripe.com. Every
// request is captured with its form-encoded params and its Idempotency-Key
// header (a DD-012 carve-out: idempotency keys must be identical between the
// editions). Ids are unique for the whole run — a run nonce plus a counter
// that `reset()` deliberately does NOT rewind: Java pins stripe_customer_id
// unique across billing accounts, so a fixture that re-minted `cus_..._0001`
// after every test would make the second org's checkout fail on that
// constraint (the first hermetic run found exactly this).
//
// Inbound: `signedEvent` builds a Stripe event envelope and its
// Stripe-Signature header exactly as Stripe would — `t=<unix>,v1=<hmac>` over
// `<t>.<payload>` with the webhook secret the server was booted with — so the
// suite drives POST /webhook/stripe without a network and the signature
// contract (also a carve-out) is asserted end to end: a wrong secret, a stale
// timestamp or a tampered payload must be refused with 400 "Invalid signature".
//
// Why not stripe-mock: it mints static ids (two tests' sessions collide on
// the purchase lookup) and captures nothing (idempotency keys unassertable).
//
// The api_version trap (finding F12 of entry 20260906.04): the Java handlers
// read event data through `getDataObjectDeserializer().getObject()`, which
// answers EMPTY unless the event's `api_version` equals the stripe-java pin —
// every handler then logs "Failed to deserialize event data" and does
// nothing, with no pointer at the cause. Events built here carry the pin. The
// composition (stripe-node) parses regardless; C5 must not copy the strictness.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readBody } from "./fake-llm-upstream";
import { writeJson } from "./llm-wire";

// The API version stripe-java 32.1.0 (stigmer-cloud MODULE.bazel) pins in
// com.stripe.Stripe.API_VERSION — read from the published jar's class
// constant pool on 2026-09-06. Bump with the Java dependency.
export const STRIPE_JAVA_API_VERSION = "2026-04-22.dahlia";

export interface CapturedStripeRequest {
  readonly method: string;
  readonly path: string;
  // The form-encoded body, decoded to a flat map of Stripe's bracketed keys
  // (e.g. `line_items[0][price_data][unit_amount]`).
  readonly params: Record<string, string>;
  readonly idempotencyKey: string | undefined;
  readonly headers: Record<string, string>;
  // What the fixture answered — the id a later assertion will look for.
  readonly response: { readonly status: number; readonly id: string | undefined };
}

// A scripted failure for the NEXT matching call: Stripe-shaped error body.
export interface StripeFailure {
  readonly pathPrefix: string;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export class FakeStripeApi {
  private server: Server | undefined;
  private captured: CapturedStripeRequest[] = [];
  private failures: StripeFailure[] = [];
  private counter = 0;
  private readonly runNonce = randomBytes(3).toString("hex");
  // Customers this fixture created, so a retrieve/update answers the shape
  // Java expects; payment methods are minted on first retrieve.
  private readonly customers = new Map<string, Record<string, unknown>>();

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  url(): string {
    if (this.server === undefined) throw new Error("FakeStripeApi.start() must be called before url()");
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  requests(): readonly CapturedStripeRequest[] {
    return this.captured;
  }

  failNext(failure: StripeFailure): void {
    this.failures.push(failure);
  }

  // Clears captures, scripted failures and customers; NOT the id counter (see
  // the module doc — ids must stay unique across the whole run).
  reset(): void {
    this.captured = [];
    this.failures = [];
    this.customers.clear();
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_conf_${this.runNonce}_${String(this.counter).padStart(4, "0")}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "";
    const path = new URL(req.url ?? "/", "http://fake").pathname;
    const params = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const idempotencyKey = headerValue(req, "idempotency-key");
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
    );

    const failureIndex = this.failures.findIndex((f) => path.startsWith(f.pathPrefix));
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      if (failure !== undefined) {
        this.captured.push({ method, path, params, idempotencyKey, headers, response: { status: failure.status, id: undefined } });
        writeJson(res, failure.status, { error: { type: "invalid_request_error", code: failure.code, message: failure.message } });
        return;
      }
    }

    const answer = this.route(method, path, params);
    this.captured.push({ method, path, params, idempotencyKey, headers, response: { status: answer.status, id: answer.id } });
    writeJson(res, answer.status, answer.body);
  }

  private route(method: string, path: string, params: Record<string, string>): { status: number; id: string | undefined; body: unknown } {
    const now = Math.floor(Date.now() / 1000);
    if (method === "POST" && path === "/v1/customers") {
      const id = this.nextId("cus");
      const customer = {
        id,
        object: "customer",
        created: now,
        livemode: false,
        name: params["name"] ?? null,
        email: params["email"] ?? null,
        metadata: metadataOf(params),
        invoice_settings: { default_payment_method: null },
      };
      this.customers.set(id, customer);
      return { status: 200, id, body: customer };
    }
    const customerMatch = /^\/v1\/customers\/([^/]+)$/.exec(path);
    if (customerMatch !== null) {
      const id = customerMatch[1] ?? "";
      const existing = this.customers.get(id);
      if (existing === undefined) return stripeNotFound(`No such customer: '${id}'`);
      if (method === "POST") {
        const defaultPm = params["invoice_settings[default_payment_method]"];
        const updated = {
          ...existing,
          invoice_settings: { default_payment_method: defaultPm ?? null },
        };
        this.customers.set(id, updated);
        return { status: 200, id, body: updated };
      }
      return { status: 200, id, body: existing };
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const id = this.nextId("cs_test");
      return {
        status: 200,
        id,
        body: {
          id,
          object: "checkout.session",
          created: now,
          livemode: false,
          mode: params["mode"] ?? "payment",
          customer: params["customer"] ?? null,
          payment_intent: null,
          payment_status: "unpaid",
          status: "open",
          success_url: params["success_url"] ?? null,
          cancel_url: params["cancel_url"] ?? null,
          url: `https://checkout.stripe.test/c/pay/${id}`,
          metadata: metadataOf(params),
        },
      };
    }
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      const id = this.nextId("bps");
      return {
        status: 200,
        id,
        body: {
          id,
          object: "billing_portal.session",
          created: now,
          livemode: false,
          customer: params["customer"] ?? null,
          return_url: params["return_url"] ?? null,
          url: `https://billing.stripe.test/p/session/${id}`,
        },
      };
    }
    if (method === "POST" && path === "/v1/payment_intents") {
      const id = this.nextId("pi");
      return {
        status: 200,
        id,
        body: {
          id,
          object: "payment_intent",
          created: now,
          livemode: false,
          amount: Number(params["amount"] ?? "0"),
          currency: params["currency"] ?? "usd",
          customer: params["customer"] ?? null,
          payment_method: params["payment_method"] ?? null,
          status: "processing",
          metadata: metadataOf(params),
        },
      };
    }
    const pmMatch = /^\/v1\/payment_methods\/([^/]+)$/.exec(path);
    if (method === "GET" && pmMatch !== null) {
      const id = pmMatch[1] ?? "";
      return {
        status: 200,
        id,
        body: { id, object: "payment_method", type: "card", customer: null, card: { brand: "visa", last4: "4242" } },
      };
    }
    return stripeNotFound(`FakeStripeApi: unhandled ${method} ${path}`);
  }
}

function stripeNotFound(message: string): { status: number; id: undefined; body: unknown } {
  return { status: 404, id: undefined, body: { error: { type: "invalid_request_error", code: "resource_missing", message } } };
}

// Stripe's form encoding nests metadata as `metadata[key]=value`.
function metadataOf(params: Record<string, string>): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match?.[1] !== undefined) metadata[match[1]] = value;
  }
  return metadata;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// ---------------------------------------------------------------------------
// Inbound: webhook events and their signatures.

export interface StripeEventOptions {
  // Defaults to a fresh `evt_conf_<random>`; pass the same id twice for the
  // replay arm (dedup → 200, no second effect).
  id?: string;
  // Defaults to the stripe-java pin; pass another value ONLY to demonstrate
  // the Java-side strictness (F12).
  apiVersion?: string;
  created?: number;
}

export interface StripeEvent {
  readonly id: string;
  readonly object: "event";
  readonly api_version: string;
  readonly created: number;
  readonly type: string;
  readonly livemode: false;
  readonly pending_webhooks: number;
  readonly request: { id: string | null; idempotency_key: string | null };
  readonly data: { object: Record<string, unknown> };
}

// The envelope Stripe posts. `dataObject` must carry its own `object` field
// (`checkout.session`, `payment_intent`, ...) — stripe-java dispatches on it.
export function stripeEvent(type: string, dataObject: Record<string, unknown>, options: StripeEventOptions = {}): StripeEvent {
  return {
    id: options.id ?? `evt_conf_${Math.random().toString(36).slice(2, 14)}`,
    object: "event",
    api_version: options.apiVersion ?? STRIPE_JAVA_API_VERSION,
    created: options.created ?? Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: dataObject },
  };
}

export interface SignedStripePayload {
  readonly payload: string;
  readonly signature: string;
}

// Stripe-Signature as Stripe computes it: `t=<unix>,v1=<hex HMAC-SHA256 over
// "<t>.<payload>">`. `timestamp` defaults to now; pass an old one for the
// stale-timestamp arm (stripe-java's default tolerance is 300 s).
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): SignedStripePayload {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return { payload, signature: `t=${timestamp},v1=${digest}` };
}

export function signedEvent(event: StripeEvent, secret: string, timestamp?: number): SignedStripePayload {
  return signStripePayload(JSON.stringify(event), secret, timestamp);
}

// Posts a signed event to the lane exactly as Stripe would (JSON body, the
// signature header) and returns the raw response for the suite to assert on.
export async function postStripeWebhook(
  webhookBaseUrl: string,
  signed: SignedStripePayload,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${webhookBaseUrl}/webhook/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signed.signature },
    body: signed.payload,
  });
  return { status: response.status, body: await response.text() };
}
