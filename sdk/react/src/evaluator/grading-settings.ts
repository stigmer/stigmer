/**
 * The Quality tab's settings, as a person edits them, and their mapping to
 * and from an {@link Evaluator}. Kept apart from the component so the
 * conversions are unit-testable without React.
 *
 * The sample rate is shown as "one in N runs", N from 1 to 100, so a
 * person never types a fraction; a rate set through the API that is not a
 * whole one in N is kept on save unless N is changed. The monthly limit is
 * US dollars of estimated model spend.
 */
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { EvaluatorInput } from "@stigmer/sdk";

/** The largest N in "one in N runs". */
export const MAX_ONE_IN = 100;

/** The most one grade may spend, which it sets aside before it starts. */
export const GRADE_MAX_COST_USD = 0.25;

/** The settings a person edits on the Quality tab. */
export interface GradingSettings {
  readonly enabled: boolean;
  /** Grade one run in this many, 1 to {@link MAX_ONE_IN}. */
  readonly oneIn: number;
  /** The monthly limit in US dollars of estimated model spend. */
  readonly monthlyLimitUsd: number;
  /** The judge's model; empty for the platform's default. */
  readonly modelName: string;
}

/** The settings a new evaluator starts from: one run in ten, ten dollars a month. */
export const DEFAULT_GRADING_SETTINGS: GradingSettings = {
  enabled: true,
  oneIn: 10,
  monthlyLimitUsd: 10,
  modelName: "",
};

/** The settings an evaluator holds. */
export function settingsOf(evaluator: Evaluator): GradingSettings {
  const spec = evaluator.spec;
  const rate = spec?.sampleRate ?? 0;
  return {
    enabled: spec?.enabled ?? false,
    oneIn: rate > 0 ? clampOneIn(Math.round(1 / rate)) : DEFAULT_GRADING_SETTINGS.oneIn,
    monthlyLimitUsd: spec?.monthlyLimitUsd ?? DEFAULT_GRADING_SETTINGS.monthlyLimitUsd,
    modelName: spec?.modelName ?? "",
  };
}

/** The create or update input for an agent's evaluator with `settings`. */
export function evaluatorInputOf(
  agent: { readonly id: string; readonly org: string },
  settings: GradingSettings,
  existing: Evaluator | null,
): EvaluatorInput {
  return {
    ...(existing?.metadata?.id ? { id: existing.metadata.id } : {}),
    name: existing?.metadata?.name ?? "",
    org: existing?.metadata?.org ?? agent.org,
    agentId: agent.id,
    enabled: settings.enabled,
    sampleRate: sampleRateOf(settings, existing),
    monthlyLimitUsd: settings.monthlyLimitUsd,
    modelName: settings.modelName,
  };
}

/**
 * Whether a valid limit is below one grade's maximum cost, so that every
 * sampled run is refused as "spending limit reached".
 */
export function gradesNoRun(usd: number): boolean {
  return isValidLimit(usd) && usd < GRADE_MAX_COST_USD;
}

/** Whether a limit a person typed can be saved. */
export function isValidLimit(usd: number): boolean {
  return Number.isFinite(usd) && usd > 0 && usd <= 100_000;
}

/** The rate to save: the stored one while N is unchanged, else 1/N. */
function sampleRateOf(settings: GradingSettings, existing: Evaluator | null): number {
  const oneIn = clampOneIn(settings.oneIn);
  if (existing !== null && settingsOf(existing).oneIn === oneIn && (existing.spec?.sampleRate ?? 0) > 0) {
    return existing.spec?.sampleRate ?? 0;
  }
  return 1 / oneIn;
}

function clampOneIn(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GRADING_SETTINGS.oneIn;
  return Math.min(MAX_ONE_IN, Math.max(1, Math.round(value)));
}
