// The gallery's fixed data beyond the scenario catalogue and `samples`
// (`@stigmer/react-sdk/test`): the model registry the provider fetches,
// provider keys, and the dashboard's figures. Every time is stamped from the
// samples' instant, so nothing reads the clock.
//
// The registry is a frozen excerpt of the server's own
// (backend/services/stigmer-server/src/modelcatalog/data/model-registry.json,
// 2026-10-27), not the file itself: a picture of the model picker should
// change when the picker changes, not every time a model is added.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ProviderKeySchema, type ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import type { DashboardSummary } from "@stigmer/react-sdk";
import { samples, sampleDate } from "@stigmer/react-sdk/test";

/** The model registry document, as `/v1/proxy/model-registry` serves it. */
export const MODEL_REGISTRY = {
  models: [
    model("stigmer", "claude-haiku-4.5", "Claude Haiku 4.5", "Quick responses, lower cost", "fastest", "economy", true, { thinking: true }),
    model("stigmer", "claude-sonnet-4.6", "Claude Sonnet 4.6", "Best for most tasks", "fast", "standard", true, { adaptiveThinking: true }),
    model("stigmer", "claude-opus-4.8", "Claude Opus 4.8", "Frontier agentic coding", "slow", "premium", true, { adaptiveThinking: true }),
    model("stigmer", "claude-sonnet-4.5", "Claude Sonnet 4.5", "Reliable all-purpose model", "fast", "standard", false, { thinking: true }),
    model("claude", "claude-haiku-4.5", "Claude Haiku 4.5", "Quick responses, lower cost", "fastest", "economy", true, { thinking: true }),
    model("claude", "claude-sonnet-4.6", "Claude Sonnet 4.6", "Best for most tasks", "fast", "standard", true, { adaptiveThinking: true }),
    model("claude", "claude-opus-4.8", "Claude Opus 4.8", "Frontier agentic coding", "slow", "premium", true, { adaptiveThinking: true }),
  ],
} as const;

/** One registry entry: an Anthropic model, with vision and the thinking it offers. */
function model(
  harness: "stigmer" | "claude",
  id: string,
  displayName: string,
  shortDescription: string,
  speedTier: "fastest" | "fast" | "slow",
  costTier: "economy" | "standard" | "premium",
  featured: boolean,
  thinking: { readonly thinking?: boolean; readonly adaptiveThinking?: boolean },
) {
  return {
    id,
    displayName,
    shortDescription,
    speedTier,
    provider: "anthropic",
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

/** The organization's own Anthropic key, saved a week before the samples' instant and used a day before it. */
export function ownAnthropicKey(): ProviderKey {
  return create(ProviderKeySchema, {
    org: ORG_ID,
    provider: "anthropic",
    keyHint: "x7Qa",
    createdBy: "person-ada",
    createdAt: timestampFromDate(sampleDate(-7 * 86_400_000)),
    updatedAt: timestampFromDate(sampleDate(-7 * 86_400_000)),
    lastUsedAt: timestampFromDate(sampleDate(-86_400_000)),
  });
}

/** An OpenAI key the parent organization holds, served to this one read-only, against the parent's own endpoint. */
export function inheritedOpenAiKey(): ProviderKey {
  return create(ProviderKeySchema, {
    org: "org-00000000-0000-0000-0000-0000000000aa",
    provider: "openai",
    keyHint: "m2Lk",
    createdBy: "person-grace",
    createdAt: timestampFromDate(sampleDate(-30 * 86_400_000)),
    updatedAt: timestampFromDate(sampleDate(-30 * 86_400_000)),
    inheritedFromOrg: "acme-holdings",
    baseUrl: "https://gateway.acme.example/v1",
  });
}

/** The dashboard's figures for a busy week. */
export const DASHBOARD_SUMMARY: DashboardSummary = {
  activeCount: 3,
  completedCount: 128,
  failedCount: 4,
  totalTokens: 18_432_500,
  orgUsage: null,
};
