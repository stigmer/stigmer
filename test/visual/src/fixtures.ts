// The gallery's fixed data beyond the scenario catalogue and `samples`
// (`@stigmer/react-sdk/test`): the model registry the provider fetches,
// which models can run (the server's readiness answer), provider keys, the
// person's account, and the dashboard's figures. Every time is stamped from
// the samples' instant, so nothing reads the clock.
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
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
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
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { GetOrgUsageReportOutputSchema, RunSummarySchema, type GetOrgUsageReportOutput, type RunSummary } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ListAgentVersionsResponseSchema, type ListAgentVersionsResponse } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { BillingAccountSchema, type BillingAccount } from "@stigmer/apis/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/apis/ai/stigmer/billing/v1/enum_pb";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  type ModelPricingBaseline,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { PlanSchema, type Plan } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument } from "@stigmer/apis/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/apis/ai/stigmer/billing/plan/v1/status_pb";
import { SubscriptionSchema, type Subscription } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/api_pb";
import {
  AgentHoursSchema,
  AgentHoursWindow,
  PeriodEstimateLineKind,
  PeriodEstimateSchema,
  type AgentHours,
  type PeriodEstimate,
} from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { SubscriptionState } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/status_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
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

/** The person's own account, with no default models chosen. */
export const ACCOUNT = create(IdentityAccountSchema, {
  metadata: { id: "ia-ada", name: "Ada Lovelace", slug: "ada", org: ORG_ID },
  spec: { idpId: "auth0|ada", email: "ada@acme.example" },
});

/**
 * The organization's own Anthropic key, checked with Anthropic, saved a week
 * before the samples' instant (by Ada unless a scene names who) and used a
 * day before it.
 */
export function ownAnthropicKey(savedBy = "ada@acme.example"): ProviderKey {
  return create(ProviderKeySchema, {
    org: ORG_ID,
    provider: "anthropic",
    keyHint: "x7Qa",
    check: ProviderKeyCheck.checked,
    createdBy: savedBy,
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

/** The dashboard's figures for an organization that has run nothing yet. */
export const NEW_ORG_SUMMARY: DashboardSummary = {
  activeCount: 0,
  completedCount: 0,
  failedCount: 0,
  totalTokens: 0,
  orgUsage: null,
};

/**
 * The ledger agent the story's sessions run (story.tsx): what it is made
 * of, so its page has something to say: its model, two skills, an MCP
 * server, a plugin and a sub-agent, shared with the organization, made a
 * month before the samples' instant and changed a day before it.
 */
export const LEDGER_AGENT: Agent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: {
    id: "agt_00000000000000000000000042",
    name: "Ledger reviewer",
    slug: "ledger-reviewer",
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    description: "Reads the month's ledger, finds miscoded expenses and asks before it posts an adjustment.",
    instructions:
      "You review the organization's ledger. Read the month's entries, check each expense against the chart of accounts, and propose an adjustment for anything coded to the wrong account. Never post an adjustment without asking first.",
    runConfig: { modelName: "claude-sonnet-4.6" },
    skillRefs: [
      { org: ORG_ID, kind: ApiResourceKind.skill, slug: "chart-of-accounts" },
      { org: ORG_ID, kind: ApiResourceKind.skill, slug: "month-end-close" },
    ],
    mcpServers: [{ name: "ledger", url: "https://ledger.acme.example/mcp" }],
    subagents: [{ org: ORG_ID, kind: ApiResourceKind.agent, slug: "receipt-matcher" }],
  },
  status: {
    audit: {
      specAudit: {
        createdBy: { id: "ia-ada", displayName: "Ada Lovelace", email: "ada@acme.example" },
        createdAt: timestampFromDate(sampleDate(-30 * 86_400_000)),
        updatedAt: timestampFromDate(sampleDate(-86_400_000)),
      },
    },
  },
});

const DAY_MS = 86_400_000;

/** A date `days` before the samples' instant, as the usage report names a day. */
function reportDay(days: number): string {
  return sampleDate(-days * DAY_MS).toISOString().slice(0, 10);
}

/** Each registry model's list price in US dollars per million input and output tokens. */
const PRICES: Readonly<Record<string, readonly [number, number]>> = {
  "claude-haiku-4.5": [1, 5],
  "claude-sonnet-4.6": [3, 15],
  "claude-opus-4.8": [5, 25],
  "claude-sonnet-4.5": [3, 15],
  "gpt-5.2": [1.75, 14],
};

/** The runs each of the week's days held, oldest first, and their tokens. */
const WEEK = [
  [14, 1_910_400],
  [22, 3_120_800],
  [19, 2_604_100],
  [25, 3_488_000],
  [18, 2_377_900],
  [9, 1_266_300],
  [21, 3_665_000],
] as const;

/** The organization's usage over a busy week: its runs by day, by model and by agent, and the totals. */
export const BUSY_WEEK_USAGE: GetOrgUsageReportOutput = create(GetOrgUsageReportOutputSchema, {
  org: ORG_ID,
  totalAgents: 6,
  totalSessions: 74,
  totalRuns: 128,
  modelBreakdown: [
    { model: "claude-sonnet-4.6", provider: "anthropic", inputTokens: 11_820_000n, outputTokens: 2_410_000n, callCount: 1_874, totalTokens: 14_230_000n },
    { model: "claude-haiku-4.5", provider: "anthropic", inputTokens: 3_160_000n, outputTokens: 642_500n, callCount: 1_102, totalTokens: 3_802_500n },
    { model: "claude-opus-4.8", provider: "anthropic", inputTokens: 330_000n, outputTokens: 70_000n, callCount: 41, totalTokens: 400_000n },
  ],
  topAgents: [
    { agentId: "agt_00000000000000000000000042", agentName: "Ledger reviewer", runCount: 61, totalTokens: 9_104_000n, workingSeconds: 21_480n },
    { agentId: "agt_00000000000000000000000043", agentName: "Receipt matcher", runCount: 38, totalTokens: 5_220_500n, workingSeconds: 9_960n },
    { agentId: "agt_00000000000000000000000044", agentName: "Vendor onboarding", runCount: 29, totalTokens: 4_108_000n, workingSeconds: 7_320n },
  ],
  dailyUsage: WEEK.map(([runCount, totalTokens], index) => ({
    date: reportDay(WEEK.length - 1 - index),
    runCount,
    totalTokens: BigInt(totalTokens),
    llmCallCount: runCount * 23,
  })),
  harnessUsage: [{ harness: "stigmer", totalTokens: 18_432_500n, callCount: 3_017, runCount: 128 }],
  totalUsage: {
    inputTokens: 15_310_000n,
    outputTokens: 3_122_500n,
    totalTokens: 18_432_500n,
    workingSeconds: 38_760n,
    llmCallCount: 3_017,
    primaryModel: "claude-sonnet-4.6",
    primaryProvider: "anthropic",
  },
});

/** The usage report of an organization that has run nothing. */
export const EMPTY_USAGE: GetOrgUsageReportOutput = create(GetOrgUsageReportOutputSchema, { org: ORG_ID });

/** The runs of a busy week by phase, three still at work. */
export const BUSY_WEEK_RUNS: RunSummary = create(RunSummarySchema, {
  activeCount: 3,
  phaseCounts: { [RunPhase.RUN_COMPLETED]: 128, [RunPhase.RUN_FAILED]: 4 },
  topFailingAgents: [{ agentSlug: "receipt-matcher", agentName: "Receipt matcher", failureCount: 3 }],
});

/** The runs of an organization that has run nothing. */
export const NO_RUNS: RunSummary = create(RunSummarySchema, {});

/** The ledger agent's versions: three applies, the newest current. */
export const LEDGER_AGENT_VERSIONS: ListAgentVersionsResponse = create(ListAgentVersionsResponseSchema, {
  entries: [
    { versionHash: "9f3c1a7e", appliedAt: timestampFromDate(sampleDate(-DAY_MS)), isCurrent: true, message: "Ask before posting any adjustment" },
    { versionHash: "4b82d0c5", appliedAt: timestampFromDate(sampleDate(-12 * DAY_MS)), message: "Add the month-end close skill" },
    { versionHash: "17e6a9b2", appliedAt: timestampFromDate(sampleDate(-30 * DAY_MS)), message: "First version" },
  ],
});

/** The organization's billing account: active, with a card on file. */
export const BILLING_ACCOUNT: BillingAccount = create(BillingAccountSchema, {
  id: "ba_00000000000000000000000001",
  org: ORG_ID,
  status: BillingAccountStatus.billing_account_active,
  defaultPaymentMethod: { paymentMethodId: "pm_gallery", brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
  createdAt: timestampFromDate(sampleDate(-60 * DAY_MS)),
  updatedAt: timestampFromDate(sampleDate(-60 * DAY_MS)),
});

/** The model catalogue's active prices: the registry fixture's models, each at its list price per million tokens. */
export const PRICING_BASELINES: readonly ModelPricingBaseline[] = MODEL_REGISTRY.models.map((entry, index) => {
  const [input, output] = PRICES[entry.id] ?? [3, 15];
  return create(ModelPricingBaselineSchema, {
    baselineId: `mpb_${String(index + 1).padStart(4, "0")}`,
    modelId: entry.id,
    apiModelId: entry.id,
    provider: entry.provider,
    harness: entry.harness,
    displayName: entry.displayName,
    shortDescription: entry.shortDescription,
    speedTier: entry.speedTier,
    costTier: entry.costTier,
    featured: entry.featured,
    pricing: {
      inputPriceMicrosPerMillion: BigInt(input * 1_000_000),
      outputPriceMicrosPerMillion: BigInt(output * 1_000_000),
      source: `${entry.provider} list price`,
      effectiveAt: timestampFromDate(sampleDate(-90 * DAY_MS)),
    },
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    status: ModelPricingBaselineStatus.pricing_baseline_active,
    createdAt: timestampFromDate(sampleDate(-90 * DAY_MS)),
  });
});

/** A US dollar in micros, the plans' unit. */
const USD = 1_000_000n;

/** The plans Stigmer Cloud offers, in the launch catalogue's shape: Team and Business. */
export const PLANS: readonly Plan[] = [
  create(PlanSchema, {
    metadata: { id: "pln_team", name: "Team", slug: "team" },
    spec: {
      instrument: PlanInstrument.subscription,
      entitlements: { features: [Feature.channels, Feature.chat_links, Feature.teams] },
      terms: { monthlyMinimumMicros: 99n * USD },
      description: "Channels, chat links and teams for one organization.",
    },
    status: { lifecycle: PlanLifecycle.active },
  }),
  create(PlanSchema, {
    metadata: { id: "pln_business", name: "Business", slug: "business" },
    spec: {
      instrument: PlanInstrument.subscription,
      entitlements: {
        features: [Feature.channels, Feature.chat_links, Feature.teams, Feature.child_orgs],
        limits: { includedChildOrgs: 5 },
      },
      terms: { monthlyMinimumMicros: 499n * USD, perExtraOrgMicros: 25n * USD },
      description: "Everything in Team, with your own provider keys, child organizations for your customers.",
    },
    status: { lifecycle: PlanLifecycle.active },
  }),
];

/** The organization's subscription: Team, active, ten days into its month. */
export const TEAM_SUBSCRIPTION: Subscription = create(SubscriptionSchema, {
  metadata: { id: "sub_00000000000000000000000001", org: ORG_ID },
  spec: { planId: "pln_team" },
  status: {
    state: SubscriptionState.active,
    currentPeriodStart: timestampFromDate(sampleDate(-10 * DAY_MS)),
    currentPeriodEnd: timestampFromDate(sampleDate(20 * DAY_MS)),
  },
});

/** The organization's agent hours this period: ten and three quarters worked, on a plan that includes none. */
export const TEAM_AGENT_HOURS: AgentHours = create(AgentHoursSchema, {
  workingSeconds: 38_760n,
  windowStart: timestampFromDate(sampleDate(-10 * DAY_MS)),
  windowEnd: timestampFromDate(sampleDate(20 * DAY_MS)),
  window: AgentHoursWindow.billing_period,
});

/** What this period will cost so far: Team's monthly fee. */
export const TEAM_ESTIMATE: PeriodEstimate = create(PeriodEstimateSchema, {
  planId: "pln_team",
  periodStart: timestampFromDate(sampleDate(-10 * DAY_MS)),
  periodEnd: timestampFromDate(sampleDate(20 * DAY_MS)),
  lines: [{ kind: PeriodEstimateLineKind.plan, amountMicros: 99n * USD }],
  totalMicros: 99n * USD,
});
