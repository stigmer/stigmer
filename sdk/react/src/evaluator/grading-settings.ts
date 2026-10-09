/**
 * The Quality tab's settings, as a person edits them, and their mapping to
 * and from an {@link Evaluator}. Kept apart from the component so the
 * conversions are unit-testable without React.
 *
 * The sample rate is shown as "one in N runs", N from 1 to 100, so a
 * person never types a fraction; the monthly limit is US dollars of
 * estimated model spend.
 */
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { EvaluatorInput } from "@stigmer/sdk";

/** The largest N in "one in N runs". */
export const MAX_ONE_IN = 100;

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
    sampleRate: 1 / clampOneIn(settings.oneIn),
    monthlyLimitUsd: settings.monthlyLimitUsd,
    modelName: settings.modelName,
  };
}

/** Whether a limit a person typed can be saved. */
export function isValidLimit(usd: number): boolean {
  return Number.isFinite(usd) && usd > 0 && usd <= 100_000;
}

function clampOneIn(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GRADING_SETTINGS.oneIn;
  return Math.min(MAX_ONE_IN, Math.max(1, Math.round(value)));
}
