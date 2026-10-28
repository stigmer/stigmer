/**
 * Which model providers a runner reaches, and how, judged from its
 * environment alone — the one copy of that rule in the runner.
 *
 * Why it exists: a server cannot see a runner that runs as its own process,
 * so whoever launches the runner tells the server what it reaches
 * (STIGMER_RUNNER_PROVIDERS, read by the server's `boot/config.ts`), and a
 * run that needs a provider no runner reaches is refused at create instead
 * of failing at its first model call (stigmer#1084). `stigmer up` fills that
 * setting from the runner environment it builds, so its answer must be the
 * runner's own: this rule mirrors, arm by arm, how the runner reads its
 * configuration.
 *
 *   - A proxy (`STIGMER_PROXY_ENDPOINT`, trimmed, as `preflightLlmBackends`
 *     reads it) owns routing for every provider: both, via `proxy`.
 *   - A configuration the runner refuses to boot on reaches nothing: an
 *     unsupported `STIGMER_ANTHROPIC_BACKEND` or `STIGMER_OPENAI_BACKEND`, an
 *     `ANTHROPIC_BASE_URL` that is not an http(s) URL, or a non-public
 *     Anthropic backend missing its prerequisites (`preflightLlmBackends`
 *     and the `check*Prerequisites` functions in `llm-backend.ts`).
 *   - Anthropic: a vertex, bedrock or foundry backend (each authenticates
 *     through its cloud's own credential chain); otherwise a gateway
 *     (`ANTHROPIC_BASE_URL`, which the runner's lanes call with whatever key
 *     it holds, none included); otherwise a non-blank `ANTHROPIC_API_KEY`
 *     (`checkDirectCredentials`).
 *   - OpenAI: a non-blank `OPENAI_API_KEY` (`checkDirectCredentials`).
 *
 * This module imports nothing, so a test elsewhere can load it from source
 * by path. The CLI keeps a copy (`client-apps/cli/src/local/provider-reach.ts`),
 * because the CLI depends on neither the runner nor the server;
 * `__tests__/provider-reach.test.ts` holds the two equal.
 */

/** The model providers a runner can reach, in the order they are reported. */
export const REACHABLE_PROVIDERS = ["anthropic", "openai"] as const;

export type ReachableProvider = (typeof REACHABLE_PROVIDERS)[number];

/** How a provider is reached: its own key, a gateway, a cloud backend, or a proxy. */
export type ProviderRoute = "key" | "gateway" | "vertex" | "bedrock" | "foundry" | "proxy";

export interface ProviderReach {
  readonly provider: ReachableProvider;
  readonly via: ProviderRoute;
}

/** The environment the rule reads; `process.env` and a launcher's built env both fit. */
export type ReachEnv = Readonly<Record<string, string | undefined>>;

const ANTHROPIC_BACKENDS = ["public", "vertex", "bedrock", "foundry"] as const;
type AnthropicBackend = (typeof ANTHROPIC_BACKENDS)[number];

/** The providers the runner with environment `env` reaches, in {@link REACHABLE_PROVIDERS} order. */
export function providerReach(env: ReachEnv): readonly ProviderReach[] {
  if (filled(env.STIGMER_PROXY_ENDPOINT)) {
    return REACHABLE_PROVIDERS.map((provider) => ({ provider, via: "proxy" }));
  }

  const anthropicBackend = backendOf(env.STIGMER_ANTHROPIC_BACKEND, ANTHROPIC_BACKENDS);
  const openAiBackend = backendOf(env.STIGMER_OPENAI_BACKEND, ["public"] as const);
  const baseUrl = baseUrlOf(env.ANTHROPIC_BASE_URL);
  if (anthropicBackend === null || openAiBackend === null || baseUrl === null) return [];
  if (!prerequisitesMet(anthropicBackend, env)) return [];

  const reach: ProviderReach[] = [];
  if (anthropicBackend !== "public") {
    reach.push({ provider: "anthropic", via: anthropicBackend });
  } else if (baseUrl !== "") {
    reach.push({ provider: "anthropic", via: "gateway" });
  } else if (filled(env.ANTHROPIC_API_KEY)) {
    reach.push({ provider: "anthropic", via: "key" });
  }
  if (filled(env.OPENAI_API_KEY)) reach.push({ provider: "openai", via: "key" });
  return reach;
}

/** The setting's value for a reach: the providers' names, comma-separated (`"anthropic,openai"`). */
export function runnerProvidersValue(reach: readonly ProviderReach[]): string {
  return reach.map((entry) => entry.provider).join(",");
}

/** A reach for a person to read: `anthropic (vertex), openai (key)`, or `""` when it is empty. */
export function describeReach(reach: readonly ProviderReach[]): string {
  return reach.map((entry) => `${entry.provider} (${entry.via})`).join(", ");
}

/** Non-blank after trimming. */
function filled(value: string | undefined): boolean {
  return (value?.trim() ?? "") !== "";
}

/** A backend variable's value (unset or blank: `public`), or null when the runner refuses it. */
function backendOf<B extends string>(raw: string | undefined, supported: readonly B[]): B | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return "public" as B;
  return (supported as readonly string[]).includes(value) ? (value as B) : null;
}

/** `ANTHROPIC_BASE_URL` trimmed (`""` when unset or blank), or null when it is not an http(s) URL. */
function baseUrlOf(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return "";
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  return value;
}

/** Whether a non-public backend's boot prerequisites hold (`check*Prerequisites` in `llm-backend.ts`). */
function prerequisitesMet(backend: AnthropicBackend, env: ReachEnv): boolean {
  switch (backend) {
    case "public":
      return true;
    case "vertex":
      return filled(env.CLOUD_ML_REGION);
    case "bedrock":
      return filled(env.AWS_REGION) && modelMapValid(env.STIGMER_BEDROCK_MODEL_MAP);
    case "foundry":
      return (
        filled(env.ANTHROPIC_FOUNDRY_RESOURCE) !== filled(env.ANTHROPIC_FOUNDRY_BASE_URL) &&
        modelMapValid(env.STIGMER_FOUNDRY_DEPLOYMENT_MAP)
      );
  }
}

/** Whether an override map parses: comma-separated `canonical=target` pairs, blank entries skipped. */
function modelMapValid(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return true;
  for (const entry of trimmed.split(",")) {
    const pair = entry.trim();
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq === -1 || pair.slice(0, eq).trim() === "" || pair.slice(eq + 1).trim() === "") return false;
  }
  return true;
}
