/**
 * Pins the reach rule (`shared/provider-reach.ts`): which model providers a
 * runner reaches, and how, from its environment alone.
 *
 *   - each arm of the rule, one case per way a provider is reached or missed;
 *   - the rule agrees with the runner's own reading of the same environment:
 *     a configuration `preflightLlmBackends` refuses reaches nothing, and
 *     where no gateway is set, a provider is reached exactly when
 *     `checkDirectCredentials` finds its credential;
 *   - the CLI's copy (`client-apps/cli/src/local/provider-reach.ts`), which
 *     `stigmer up` fills the server's STIGMER_RUNNER_PROVIDERS with, gives
 *     the same answer as this one over every environment in the matrix.
 *
 * The CLI module is loaded by URL, as `environment/__tests__/platform-lanes.test.ts`
 * loads the server's module, so the runner's typecheck never follows the
 * CLI's tree; it imports nothing, so loading it pulls in nothing else.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { checkDirectCredentials, preflightLlmBackends } from "../llm-backend.js";
import {
  describeReach,
  providerReach,
  REACHABLE_PROVIDERS,
  runnerProvidersValue,
  type ProviderReach,
  type ReachEnv,
} from "../provider-reach.js";

interface ReachRule {
  readonly REACHABLE_PROVIDERS: readonly string[];
  readonly providerReach: (env: ReachEnv) => readonly ProviderReach[];
  readonly runnerProvidersValue: (reach: readonly ProviderReach[]) => string;
  readonly describeReach: (reach: readonly ProviderReach[]) => string;
}

async function cliCopy(): Promise<ReachRule> {
  const path = resolve(import.meta.dirname, "../../../../../../client-apps/cli/src/local/provider-reach.ts");
  return (await import(pathToFileURL(path).href)) as ReachRule;
}

const KEY = "sk-test";

/** Every environment the rule distinguishes, named for the failure message. */
const MATRIX: ReadonlyArray<readonly [string, ReachEnv]> = [
  ["no environment", {}],
  ["an Anthropic key", { ANTHROPIC_API_KEY: KEY }],
  ["an OpenAI key", { OPENAI_API_KEY: KEY }],
  ["a Cursor key, which no engine reads", { CURSOR_API_KEY: KEY }],
  ["both keys", { ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: KEY }],
  ["empty keys", { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }],
  ["blank keys", { ANTHROPIC_API_KEY: "  ", OPENAI_API_KEY: "  " }],
  ["a gateway without a key", { ANTHROPIC_BASE_URL: "https://llm-gateway.internal" }],
  ["a gateway with a key", { ANTHROPIC_BASE_URL: "https://llm-gateway.internal/", ANTHROPIC_API_KEY: KEY }],
  ["a blank gateway with a key", { ANTHROPIC_BASE_URL: "  ", ANTHROPIC_API_KEY: KEY }],
  ["a gateway that is not a URL", { ANTHROPIC_BASE_URL: "llm-gateway.internal", OPENAI_API_KEY: KEY }],
  ["a gateway on another scheme", { ANTHROPIC_BASE_URL: "ftp://llm-gateway.internal", ANTHROPIC_API_KEY: KEY }],
  ["vertex with its region", { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global" }],
  ["vertex, upper case, with its region", { STIGMER_ANTHROPIC_BACKEND: " Vertex ", CLOUD_ML_REGION: "asia-south1" }],
  ["vertex without its region", { STIGMER_ANTHROPIC_BACKEND: "vertex", OPENAI_API_KEY: KEY }],
  ["vertex with a blank region", { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: " " }],
  ["vertex beside a gateway", { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global", ANTHROPIC_BASE_URL: "https://gw.example" }],
  ["bedrock with its region", { STIGMER_ANTHROPIC_BACKEND: "bedrock", AWS_REGION: "ap-south-1" }],
  ["bedrock without its region", { STIGMER_ANTHROPIC_BACKEND: "bedrock", ANTHROPIC_API_KEY: KEY }],
  ["bedrock with a valid model map", { STIGMER_ANTHROPIC_BACKEND: "bedrock", AWS_REGION: "us-east-1", STIGMER_BEDROCK_MODEL_MAP: "claude-sonnet-4-6=us.anthropic.claude-sonnet-4-6-v1:0, ," }],
  ["bedrock with a malformed model map", { STIGMER_ANTHROPIC_BACKEND: "bedrock", AWS_REGION: "us-east-1", STIGMER_BEDROCK_MODEL_MAP: "claude-sonnet-4-6" }],
  ["foundry with its resource", { STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "my-foundry" }],
  ["foundry with its base URL", { STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_BASE_URL: "https://my-foundry.services.ai.azure.com/anthropic/" }],
  ["foundry with neither", { STIGMER_ANTHROPIC_BACKEND: "foundry", OPENAI_API_KEY: KEY }],
  ["foundry with both", { STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "r", ANTHROPIC_FOUNDRY_BASE_URL: "https://r.example" }],
  ["foundry with a malformed deployment map", { STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "r", STIGMER_FOUNDRY_DEPLOYMENT_MAP: "=x" }],
  ["an unsupported Anthropic backend", { STIGMER_ANTHROPIC_BACKEND: "azure", ANTHROPIC_API_KEY: KEY }],
  ["an explicit public backend with a key", { STIGMER_ANTHROPIC_BACKEND: "public", ANTHROPIC_API_KEY: KEY }],
  ["a blank backend with a key", { STIGMER_ANTHROPIC_BACKEND: "  ", ANTHROPIC_API_KEY: KEY }],
  ["the planned OpenAI backend", { STIGMER_OPENAI_BACKEND: "azure", ANTHROPIC_API_KEY: KEY }],
  ["a proxy", { STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai" }],
  ["a proxy over a broken backend", { STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai", STIGMER_ANTHROPIC_BACKEND: "vertex" }],
  ["a blank proxy with a key", { STIGMER_PROXY_ENDPOINT: "  ", ANTHROPIC_API_KEY: KEY }],
];

describe("providerReach — the arms", () => {
  it("reaches nothing in an empty environment", () => {
    expect(providerReach({})).toEqual([]);
  });

  it("reaches each provider by its own key, in the fixed provider order", () => {
    expect(providerReach({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY })).toEqual([
      { provider: "anthropic", via: "key" },
      { provider: "openai", via: "key" },
    ]);
  });

  it("counts a blank Anthropic or OpenAI key as unset, as checkDirectCredentials does", () => {
    expect(providerReach({ ANTHROPIC_API_KEY: " ", OPENAI_API_KEY: "\t" })).toEqual([]);
  });

  it("reaches no provider on a Cursor key, which no engine reads", () => {
    expect(providerReach({ CURSOR_API_KEY: KEY })).toEqual([]);
  });

  it("reaches Anthropic through a gateway, with or without a key", () => {
    expect(providerReach({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4242" })).toEqual([{ provider: "anthropic", via: "gateway" }]);
    expect(providerReach({ ANTHROPIC_BASE_URL: "https://gw.example", ANTHROPIC_API_KEY: KEY })).toEqual([
      { provider: "anthropic", via: "gateway" },
    ]);
  });

  it("reaches Anthropic through each cloud backend whose prerequisites hold", () => {
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global" })).toEqual([
      { provider: "anthropic", via: "vertex" },
    ]);
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "bedrock", AWS_REGION: "eu-west-1" })).toEqual([
      { provider: "anthropic", via: "bedrock" },
    ]);
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "r" })).toEqual([
      { provider: "anthropic", via: "foundry" },
    ]);
  });

  it("reaches nothing when the runner would refuse to boot", () => {
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "vertex", OPENAI_API_KEY: KEY })).toEqual([]);
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "bedrock", AWS_REGION: "x", STIGMER_BEDROCK_MODEL_MAP: "a=" })).toEqual([]);
    expect(providerReach({ STIGMER_ANTHROPIC_BACKEND: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "r", ANTHROPIC_FOUNDRY_BASE_URL: "https://r" })).toEqual([]);
    expect(providerReach({ STIGMER_OPENAI_BACKEND: "azure", OPENAI_API_KEY: KEY })).toEqual([]);
    expect(providerReach({ ANTHROPIC_BASE_URL: "not a url", ANTHROPIC_API_KEY: KEY })).toEqual([]);
  });

  it("reaches both through a proxy, which owns routing over every other setting", () => {
    expect(providerReach({ STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai", STIGMER_ANTHROPIC_BACKEND: "nonsense" })).toEqual(
      REACHABLE_PROVIDERS.map((provider) => ({ provider, via: "proxy" })),
    );
  });

  it("renders the setting's value and the readable line", () => {
    const reach = providerReach({ STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "global", OPENAI_API_KEY: KEY });
    expect(runnerProvidersValue(reach)).toBe("anthropic,openai");
    expect(describeReach(reach)).toBe("anthropic (vertex), openai (key)");
    expect(runnerProvidersValue([])).toBe("");
    expect(describeReach([])).toBe("");
  });
});

describe("providerReach agrees with the runner's own reading", () => {
  it.each(MATRIX)("%s", (_name, env) => {
    const reach = providerReach(env);
    const reached = new Set(reach.map((entry) => entry.provider));
    const processEnv = { ...env } as NodeJS.ProcessEnv;
    const preflight = preflightLlmBackends(processEnv);
    const proxied = (env.STIGMER_PROXY_ENDPOINT?.trim() ?? "") !== "";

    if (preflight.error !== null) {
      expect(reach, "a configuration the runner refuses to boot on reaches nothing").toEqual([]);
      return;
    }
    if (proxied) return;
    expect(reached.has("openai")).toBe(checkDirectCredentials("openai", processEnv) === null);
    const gateway = reach.some((entry) => entry.via === "gateway");
    if (!gateway) {
      expect(reached.has("anthropic")).toBe(checkDirectCredentials("anthropic", processEnv) === null);
    }
  });
});

describe("the CLI's copy of the rule", () => {
  it("lists the same providers in the same order", async () => {
    expect((await cliCopy()).REACHABLE_PROVIDERS).toEqual(REACHABLE_PROVIDERS);
  });

  it.each(MATRIX)("gives the runner's answer for %s", async (_name, env) => {
    const cli = await cliCopy();
    const reach = providerReach(env);
    expect(cli.providerReach(env)).toEqual(reach);
    expect(cli.runnerProvidersValue(reach)).toBe(runnerProvidersValue(reach));
    expect(cli.describeReach(reach)).toBe(describeReach(reach));
  });
});
