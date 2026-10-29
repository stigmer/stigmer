// The gallery's fixed data beyond the scenario catalogue and `samples`
// (`@stigmer/react-sdk/test`): the model registry the provider fetches,
// which models can run (the server's readiness answer), provider keys, and
// the dashboard's figures. Every time is stamped from the samples' instant,
// so nothing reads the clock.
//
// The registry is a frozen excerpt of the server's own
// (backend/services/stigmer-server/src/modelcatalog/data/model-registry.json,
// 2026-10-27), not the file itself: a picture of the model picker should
// change when the picker changes, not every time a model is added. It adds
// one OpenAI model on the Stigmer engine, which the server's catalogue does
// not list today, so a picture can show a model that runs beside one that
// needs a key, and a provider card can show what OpenAI unlocks.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ProviderKeyCheck,
  ProviderKeySchema,
  type ProviderKey,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import {
  GetModelReadinessOutputSchema,
  ProviderAvailability,
  type GetModelReadinessOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import type { DashboardSummary } from "@stigmer/react-sdk";
import { samples, sampleDate } from "@stigmer/react-sdk/test";

/** The model registry document, as `/v1/proxy/model-registry` serves it. */
export const MODEL_REGISTRY = {
  models: [
    model("stigmer", "claude-haiku-4.5", "Claude Haiku 4.5", "Quick responses, lower cost", "fastest", "economy", true, { thinking: true }),
    model("stigmer", "claude-sonnet-4.6", "Claude Sonnet 4.6", "Best for most tasks", "fast", "standard", true, { adaptiveThinking: true }),
    model("stigmer", "claude-opus-4.8", "Claude Opus 4.8", "Frontier agentic coding", "slow", "premium", true, { adaptiveThinking: true }),
    model("stigmer", "claude-sonnet-4.5", "Claude Sonnet 4.5", "Reliable all-purpose model", "fast", "standard", false, { thinking: true }),
    model("stigmer", "gpt-5.2", "GPT-5.2", "OpenAI's general model", "fast", "standard", true, { thinking: true }, "openai"),
    model("claude", "claude-haiku-4.5", "Claude Haiku 4.5", "Quick responses, lower cost", "fastest", "economy", true, { thinking: true }),
    model("claude", "claude-sonnet-4.6", "Claude Sonnet 4.6", "Best for most tasks", "fast", "standard", true, { adaptiveThinking: true }),
    model("claude", "claude-opus-4.8", "Claude Opus 4.8", "Frontier agentic coding", "slow", "premium", true, { adaptiveThinking: true }),
  ],
} as const;

/** One registry entry: an Anthropic model unless named otherwise, with vision and the thinking it offers. */
function model(
  harness: "stigmer" | "claude",
  id: string,
  displayName: string,
  shortDescription: string,
  speedTier: "fastest" | "fast" | "slow",
  costTier: "economy" | "standard" | "premium",
  featured: boolean,
  thinking: { readonly thinking?: boolean; readonly adaptiveThinking?: boolean },
  provider: "anthropic" | "openai" = "anthropic",
) {
  return {
    id,
    displayName,
    shortDescription,
    speedTier,
    provider,
    harness,
    costTier,
    featured,
    capabilities: {
      vision: true,
      thinking: thinking.thinking ?? false,
      adaptiveThinking: thinking.adaptiveThinking ?? false,
      thinkingRequired: false,
    },
  };
}

/** The samples' organization, the one every settings scene is in. */
export const ORGANIZATION = samples.organization();
const ORG_ID = ORGANIZATION.metadata?.id ?? "";

/** The organization's own Anthropic key, checked with Anthropic, saved a week before the samples' instant and used a day before it. */
export function ownAnthropicKey(): ProviderKey {
  return create(ProviderKeySchema, {
    org: ORG_ID,
    provider: "anthropic",
    keyHint: "x7Qa",
    check: ProviderKeyCheck.checked,
    createdBy: "ada@acme.example",
    createdAt: timestampFromDate(sampleDate(-7 * 86_400_000)),
    updatedAt: timestampFromDate(sampleDate(-7 * 86_400_000)),
    lastUsedAt: timestampFromDate(sampleDate(-86_400_000)),
  });
}

/**
 * An OpenAI key the parent organization holds, served to this one
 * read-only, against the parent's own endpoint; OpenAI did not answer the
 * save's check.
 */
export function inheritedOpenAiKey(): ProviderKey {
  return create(ProviderKeySchema, {
    org: "org-00000000-0000-0000-0000-0000000000aa",
    provider: "openai",
    keyHint: "m2Lk",
    check: ProviderKeyCheck.unchecked,
    createdBy: "grace@acme.example",
    createdAt: timestampFromDate(sampleDate(-30 * 86_400_000)),
    updatedAt: timestampFromDate(sampleDate(-30 * 86_400_000)),
    inheritedFromOrg: "acme-holdings",
    baseUrl: "https://gateway.acme.example/v1",
  });
}

/** The parent organization whose key serves OpenAI in `readiness(...)`. */
export const PARENT_ORG = "acme-holdings";

/** The wire value of each engine the registry fixture names. */
const HARNESS_OF: Readonly<Record<"stigmer" | "claude", Harness>> = { stigmer: Harness.STIGMER, claude: Harness.CLAUDE };

/**
 * The server's readiness answer for the samples' organization: each
 * provider's availability, and every registry model on its engine with its
 * provider's.
 */
export function readiness(availability: {
  readonly anthropic: ProviderAvailability;
  readonly openai: ProviderAvailability;
}): GetModelReadinessOutput {
  const parentOf = (state: ProviderAvailability) =>
    state === ProviderAvailability.served_by_parent_organization ? PARENT_ORG : "";
  return create(GetModelReadinessOutputSchema, {
    providers: (["anthropic", "openai"] as const).map((provider) => ({
      provider,
      availability: availability[provider],
      parentOrg: parentOf(availability[provider]),
    })),
    models: MODEL_REGISTRY.models.map((entry) => ({
      harness: HARNESS_OF[entry.harness],
      model: entry.id,
      provider: entry.provider,
      availability: availability[entry.provider],
    })),
  });
}

/** Readiness with nothing connected to the organization. */
export const NOTHING_CONNECTED = readiness({
  anthropic: ProviderAvailability.missing_from_organization,
  openai: ProviderAvailability.missing_from_organization,
});

/** Readiness on a laptop whose runner has no key. */
export const NOTHING_ON_THE_RUNNER = readiness({
  anthropic: ProviderAvailability.missing_from_runners,
  openai: ProviderAvailability.missing_from_runners,
});

/** The dashboard's figures for a busy week. */
export const DASHBOARD_SUMMARY: DashboardSummary = {
  activeCount: 3,
  completedCount: 128,
  failedCount: 4,
  totalTokens: 18_432_500,
  orgUsage: null,
};
