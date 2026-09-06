// The cloud-capability fixtures as one run-scoped unit with a control API.
// Domain: conformance harness (cloud-capability fixtures, E1).
//
// The cloud targets' environment boots ONCE per run in vitest's global setup
// (global-setup-cloud.ts) while suite files run in forked workers that
// inherit only process.env. The fakes the server under test dials — the LLM
// upstream, the Stripe API, the Discord webhook — must therefore live in the
// global-setup process (the server's base URLs are fixed at boot), and the
// workers must script them from outside. This module gives the three fakes
// one lifecycle and one small HTTP CONTROL API the workers reach through
// CLOUD_ENV.fixturesControlUrl; support/cloud-fixtures-client.ts is the typed
// client over it. The control listener is separate from the fakes' own
// listeners so the server under test can never wander onto a control path.
//
// A new pattern in this harness (every earlier fake was per-file and
// in-process), named so it is recognized: "run-scoped fixture + control API".
// The composition readout boots the same fixtures through
// cloud-fixtures-standalone.ts, which prints the CLOUD_ENV lines to export.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { FakeDiscordWebhook } from "./fake-discord-webhook";
import { FakeLlmUpstream, readBody, type UpstreamScript } from "./fake-llm-upstream";
import { FakeStripeApi, type StripeFailure } from "./fake-stripe";
import { writeJson } from "./llm-wire";

// What the fixtures publish: where the server under test must be pointed, the
// secret it must be booted with, and where workers script them.
export interface CloudFixtureAddresses {
  readonly llmUpstreamUrl: string;
  readonly stripeApiUrl: string;
  readonly discordWebhookUrl: string;
  readonly stripeWebhookSecret: string;
  readonly controlUrl: string;
}

export interface CloudFixtures {
  readonly addresses: CloudFixtureAddresses;
  stop(): Promise<void>;
}

// The environment the Go launcher reads (cmd/conformance-cloudenv/main.go)
// and threads into explicit ServiceConfig fields — never ambient inheritance
// into the JVM.
export function launcherEnvFor(addresses: CloudFixtureAddresses): Record<string, string> {
  return {
    STIGMER_CONFORMANCE_STRIPE_WEBHOOK_SECRET: addresses.stripeWebhookSecret,
    STIGMER_CONFORMANCE_STRIPE_API_BASE: addresses.stripeApiUrl,
    STIGMER_CONFORMANCE_LLM_UPSTREAM_BASE_URL: addresses.llmUpstreamUrl,
    STIGMER_CONFORMANCE_LEADS_DISCORD_WEBHOOK_URL: addresses.discordWebhookUrl,
  };
}

export async function startCloudFixtures(): Promise<CloudFixtures> {
  const llm = new FakeLlmUpstream();
  const stripe = new FakeStripeApi();
  const discord = new FakeDiscordWebhook();
  await Promise.all([llm.start(), stripe.start(), discord.start()]);

  // Run-local: a real-looking `whsec_` so the signature arms exercise the
  // same code path production does, never a production secret.
  const stripeWebhookSecret = `whsec_conf_${randomBytes(24).toString("hex")}`;

  const control = createServer((req, res) => {
    void handleControl(req, res, { llm, stripe, discord });
  });
  await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
  const controlPort = (control.address() as AddressInfo).port;

  const addresses: CloudFixtureAddresses = {
    llmUpstreamUrl: llm.url(),
    stripeApiUrl: stripe.url(),
    discordWebhookUrl: discord.url(),
    stripeWebhookSecret,
    controlUrl: `http://127.0.0.1:${controlPort}`,
  };

  return {
    addresses,
    stop: async () => {
      control.closeAllConnections();
      await new Promise<void>((resolve, reject) => control.close((err) => (err ? reject(err) : resolve())));
      await Promise.all([llm.close(), stripe.close(), discord.close()]);
    },
  };
}

interface Fakes {
  readonly llm: FakeLlmUpstream;
  readonly stripe: FakeStripeApi;
  readonly discord: FakeDiscordWebhook;
}

// The control protocol — small, JSON, path-per-verb. Mirrored exactly by
// support/cloud-fixtures-client.ts; a new verb is added in both places.
async function handleControl(req: IncomingMessage, res: ServerResponse, fakes: Fakes): Promise<void> {
  const method = req.method ?? "";
  const path = new URL(req.url ?? "/", "http://control").pathname;
  const raw = await readBody(req);
  const body: unknown = raw === "" ? undefined : (JSON.parse(raw) as unknown);

  switch (`${method} ${path}`) {
    case "POST /llm/enqueue":
      fakes.llm.enqueue(body as UpstreamScript);
      return noContent(res);
    case "GET /llm/requests":
      return writeJson(res, 200, fakes.llm.requests());
    case "POST /llm/reset":
      fakes.llm.reset();
      return noContent(res);
    case "GET /stripe/requests":
      return writeJson(res, 200, fakes.stripe.requests());
    case "POST /stripe/fail-next":
      fakes.stripe.failNext(body as StripeFailure);
      return noContent(res);
    case "POST /stripe/reset":
      fakes.stripe.reset();
      return noContent(res);
    case "GET /discord/posts":
      return writeJson(res, 200, fakes.discord.posts());
    case "POST /discord/fail-next":
      fakes.discord.failNext((body as { status: number }).status);
      return noContent(res);
    case "POST /discord/reset":
      fakes.discord.reset();
      return noContent(res);
    case "POST /reset":
      fakes.llm.reset();
      fakes.stripe.reset();
      fakes.discord.reset();
      return noContent(res);
    default:
      return writeJson(res, 404, { error: `cloud fixtures control: unknown verb ${method} ${path}` });
  }
}

function noContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}
