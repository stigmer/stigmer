// Public lane conformance — /api/v1/public/{model-registry, model-pricing,
// leads/contact-sales}, the endpoints the marketing site calls without
// credentials (Class A). E1 of the DD-012 reset (entry 20260906.04): Java's
// behavior is the spec; the composition's reds are P1's acceptance.
// Domain: public REST lane.
//
// DD-012 carves the site-facing contract out as byte-identical: the
// contact-sales validation limits and error copy, the response envelope, the
// pricing entry fields the PricingPage reads. This suite pins those bytes;
// everything else it asserts as behavior.
//
// The Discord side runs against the run's fake webhook receiver
// (harness/fake-discord-webhook.ts): the server was booted with its URL, so
// a valid submission's embed can be read back and a delivery failure can be
// scripted. Gated on `publicLane` (true on cloud, false on the local OSS
// targets by DD-001 — no marketing site fronts a self-host).
//
// CORS and the permitAll edge are authentication-class arms: the hermetic
// launcher's test security mode does not load HttpSecurityConfig, so they
// skip visibly through edgeAuthenticationBypass() until the launcher entry
// runs production security (ruling Q1 of E1; P1 verifies the allow-list in
// its own smoke).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { createTarget, type TargetProfile } from "../targets";

const publicServed = createTarget().capabilities.publicLane;

let target: TargetProfile;
let baseUrl: string;
let control: CloudFixturesClient;

const CONTACT_SALES_PATH = "/api/v1/public/leads/contact-sales";

// The exact copy the site contract pins (platform/leads/ContactSalesLead.java,
// LeadsController.java).
const LEADS_COPY = {
  name: "Name is required (max 1000 characters)",
  email: "A valid email is required",
  company: "Company is required (max 1000 characters)",
  message: "Message is required",
  discordFailed: "Failed to submit. Please try again.",
} as const;

interface LeadResponse {
  success: boolean;
  error: string | null;
}

// What the marketing site's ContactSalesPage sends (site/src/components/pages/ContactSalesPage.tsx).
function siteSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contact-sales",
    name: "Ada Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines Ltd",
    message: "We would like to talk about a pilot.",
    website: "",
    // The site stamps the form-open time; a submission is "too fast" under 2 s.
    _t: Date.now() - 10_000,
    ...overrides,
  };
}

async function submit(body: Record<string, unknown>): Promise<{ status: number; json: LeadResponse }> {
  const response = await fetch(`${baseUrl}${CONTACT_SALES_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as LeadResponse };
}

function skipIfEdgeBypassed(ctx: { skip: (note?: string) => never }): void {
  const reason = target.edgeAuthenticationBypass?.();
  if (reason !== undefined) ctx.skip(reason);
}

describe.skipIf(!publicServed)("Public lane conformance — the marketing site's endpoints (publicLane targets)", () => {
  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    if (target.publicBaseUrl === undefined) {
      throw new Error(`target ${target.name} declares publicLane but provides no publicBaseUrl()`);
    }
    baseUrl = target.publicBaseUrl();
    control = requireCloudFixtures();
  });

  afterEach(async () => {
    await control.discord.reset();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  it("[public.model-registry.anonymous-json-cacheable] [public.model-registry.same-document-as-proxy] the registry is anonymous, cacheable JSON and the same document the authenticated proxy lane serves", async () => {
    const response = await fetch(`${baseUrl}/api/v1/public/model-registry`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toMatch(/max-age=3600/);
    expect(response.headers.get("cache-control")).toMatch(/public/);
    const publicDocument = await response.text();
    expect(publicDocument.length).toBeGreaterThan(2);

    if (target.proxyBaseUrl !== undefined) {
      const token = process.env["STIGMER_CONFORMANCE_CLOUD_TOKEN"] ?? "";
      const proxied = await fetch(`${target.proxyBaseUrl()}/v1/proxy/model-registry`, { headers: { authorization: `Bearer ${token}` } });
      expect(proxied.status).toBe(200);
      expect(await proxied.text()).toBe(publicDocument);
    }
  });

  it("[public.model-pricing.entries-shape-sorted-with-markup] [public.model-pricing.site-reads-entries] model pricing answers {entries:[...]} with the PricingPage's fields, sorted", async () => {
    const response = await fetch(`${baseUrl}/api/v1/public/model-pricing`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: Array<Record<string, unknown>> };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length, "the seeded baseline prices at least one model").toBeGreaterThan(0);
    const required = [
      "modelId", "displayName", "provider", "harness", "costTier",
      "inputPriceMicrosPerMillion", "outputPriceMicrosPerMillion",
      "cacheCreationPriceMicrosPerMillion", "cacheReadPriceMicrosPerMillion",
      "pricingPolicyId", "markupBasisPoints", "variants",
    ];
    for (const entry of body.entries) {
      for (const field of required) expect(entry, `entry ${String(entry["modelId"])} carries ${field}`).toHaveProperty(field);
    }
    const sortKey = (e: Record<string, unknown>): string =>
      [e["harness"], e["costTier"], e["provider"], e["modelId"]].map(String).join("\u0000");
    const keys = body.entries.map(sortKey);
    expect(keys, "sorted by harness, costTier, provider, modelId").toEqual([...keys].sort());
  });

  it("[public.leads.valid-submission-201-and-discord-embed] [public.leads.site-request-shape] a valid site submission answers 201 success and posts one embed with the lead's fields", async () => {
    const { status, json } = await submit(siteSubmission());
    expect(status).toBe(201);
    expect(json).toEqual({ success: true, error: null });

    const posts = await control.discord.posts();
    expect(posts).toHaveLength(1);
    const embed = (posts[0]?.body as { embeds: Array<Record<string, unknown>> }).embeds[0] ?? {};
    expect(embed["title"]).toBe("New contact-sales lead");
    expect(embed["description"]).toBe("We would like to talk about a pilot.");
    const fields = (embed["fields"] as Array<{ name: string; value: string }>) ?? [];
    expect(fields.map((f) => f.name)).toEqual(["Name", "Email", "Company"]);
    expect(fields.map((f) => f.value)).toEqual(["Ada Lovelace", "ada@example.com", "Analytical Engines Ltd"]);
    expect((embed["footer"] as { text: string })?.text).toBe("stigmer.ai/contact-sales");
  });

  it("[public.leads.honeypot-website-fake-201-no-post] [public.leads.too-fast-fake-201-no-post] bots get a fake 201 and nothing is posted", async () => {
    const honeypot = await submit(siteSubmission({ website: "https://spam.example" }));
    expect(honeypot.status).toBe(201);
    expect(honeypot.json.success).toBe(true);
    const tooFast = await submit(siteSubmission({ _t: Date.now() - 500 }));
    expect(tooFast.status).toBe(201);
    expect(tooFast.json.success).toBe(true);
    expect(await control.discord.posts()).toEqual([]);
  });

  it("[public.leads.validation-name] [public.leads.validation-email] [public.leads.validation-company] [public.leads.validation-message-required-and-truncated] validation refusals carry the site contract's exact copy", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "" }, LEADS_COPY.name],
      [{ name: "x".repeat(1001) }, LEADS_COPY.name],
      [{ email: "not-an-email" }, LEADS_COPY.email],
      [{ company: "   " }, LEADS_COPY.company],
      [{ company: "y".repeat(1001) }, LEADS_COPY.company],
      [{ message: "" }, LEADS_COPY.message],
    ];
    for (const [overrides, copy] of cases) {
      const { status, json } = await submit(siteSubmission(overrides));
      expect(status, JSON.stringify(overrides).slice(0, 60)).toBe(400);
      expect(json).toEqual({ success: false, error: copy });
    }
    expect(await control.discord.posts()).toEqual([]);

    const long = await submit(siteSubmission({ message: "m".repeat(6000) }));
    expect(long.status).toBe(201);
    const embed = ((await control.discord.posts())[0]?.body as { embeds: Array<{ description: string }> }).embeds[0];
    expect(embed?.description.length).toBeLessThanOrEqual(4000);
  });

  it("[public.leads.fields-trimmed] surrounding whitespace is trimmed before validation and before the embed", async () => {
    const { status } = await submit(siteSubmission({ name: "  Ada  ", company: " Engines ", message: "  hello  " }));
    expect(status).toBe(201);
    const embed = ((await control.discord.posts())[0]?.body as { embeds: Array<Record<string, unknown>> }).embeds[0] ?? {};
    const fields = (embed["fields"] as Array<{ name: string; value: string }>) ?? [];
    expect(fields.find((f) => f.name === "Name")?.value).toBe("Ada");
    expect(fields.find((f) => f.name === "Company")?.value).toBe("Engines");
    expect(embed["description"]).toBe("hello");
  });

  it("[public.leads.discord-failure-502-fail-loud] a Discord delivery failure answers 502 with the site copy — no queue, no retry", async () => {
    await control.discord.failNext(500);
    const { status, json } = await submit(siteSubmission());
    expect(status).toBe(502);
    expect(json).toEqual({ success: false, error: LEADS_COPY.discordFailed });
    expect(await control.discord.posts(), "exactly one attempt, no retry").toHaveLength(1);
  });

  it("[public.cors.allow-list-and-methods] [public.edge.public-paths-anonymous] the allow-listed origins get CORS headers and the lane is anonymous while the proxy lane on the same listener is not", async (ctx) => {
    skipIfEdgeBypassed(ctx);
    for (const origin of ["https://stigmer.ai", "https://www.stigmer.ai", "http://localhost:3000"]) {
      const response = await fetch(`${baseUrl}/api/v1/public/model-pricing`, { headers: { origin } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin"), origin).toBe(origin);
    }
    const foreign = await fetch(`${baseUrl}/api/v1/public/model-pricing`, { headers: { origin: "https://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    if (target.proxyBaseUrl !== undefined) {
      const anonymousProxy = await fetch(`${target.proxyBaseUrl()}/v1/proxy/model-registry`);
      expect(anonymousProxy.status).toBe(401);
    }
  });
});
