// Typed client for the run-scoped cloud fixtures' control API.
// Domain: conformance support (cloud-capability suites, E1).
//
// The fakes live in the global-setup process (harness/cloud-fixtures.ts);
// suites reach them over CLOUD_ENV.fixturesControlUrl. This is the only way a
// suite scripts them — never by importing the fake classes, which would run a
// second, unreachable copy inside the worker. Every verb here mirrors one
// `case` in handleControl; add them together.
//
// Discipline: the fixtures are shared across every file in the run
// (fileParallelism: false), so a suite calls `resetAll()` in afterEach — the
// MockLlmProxy rule — and never assumes an empty queue it did not create.
import { CLOUD_ENV } from "../harness/cloud-env";
import type { CapturedDiscordPost } from "../harness/fake-discord-webhook";
import type { CapturedUpstreamRequest, UpstreamScript } from "../harness/fake-llm-upstream";
import type { CapturedStripeRequest, StripeFailure } from "../harness/fake-stripe";

export class CloudFixturesClient {
  constructor(private readonly controlUrl: string) {}

  readonly llm = {
    enqueue: (script: UpstreamScript): Promise<void> => this.post("/llm/enqueue", script),
    requests: (): Promise<CapturedUpstreamRequest[]> => this.get("/llm/requests"),
    reset: (): Promise<void> => this.post("/llm/reset"),
  };

  readonly stripe = {
    requests: (): Promise<CapturedStripeRequest[]> => this.get("/stripe/requests"),
    failNext: (failure: StripeFailure): Promise<void> => this.post("/stripe/fail-next", failure),
    reset: (): Promise<void> => this.post("/stripe/reset"),
  };

  readonly discord = {
    posts: (): Promise<CapturedDiscordPost[]> => this.get("/discord/posts"),
    failNext: (status: number): Promise<void> => this.post("/discord/fail-next", { status }),
    reset: (): Promise<void> => this.post("/discord/reset"),
  };

  resetAll(): Promise<void> {
    return this.post("/reset");
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.controlUrl}${path}`);
    if (!response.ok) throw new Error(`cloud fixtures control GET ${path} answered ${response.status}`);
    return (await response.json()) as T;
  }

  private async post(path: string, body?: unknown): Promise<void> {
    const response = await fetch(`${this.controlUrl}${path}`, {
      method: "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`cloud fixtures control POST ${path} answered ${response.status}`);
  }
}

// The run's fixtures, or a loud failure: a cloud run without the control URL
// is an environment that forgot to boot them (or a composition readout that
// skipped the standalone entrypoint), and the suites that need them must say
// so rather than fail on an unreachable upstream three layers down.
export function requireCloudFixtures(): CloudFixturesClient {
  const url = process.env[CLOUD_ENV.fixturesControlUrl];
  if (url === undefined || url === "") {
    throw new Error(
      `${CLOUD_ENV.fixturesControlUrl} is not set: the cloud-capability suites need the run's fixtures ` +
        "(fake LLM upstream, fake Stripe, fake Discord). The hermetic global setup boots them; a " +
        "pre-provisioned environment starts them with `npm run fixtures:serve` and exports its lines.",
    );
  }
  return new CloudFixturesClient(url);
}
