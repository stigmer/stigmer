/**
 * Variant-attribute → Cursor variant-parameter translation
 * (stigmer/stigmer#357 service tier, #772 thinking mode).
 *
 * The platform contract: an execution's model selection is ALWAYS explicit.
 * A bare `{ id }` lets the Cursor catalog's default variant decide the
 * variant (observed 2026-08-06: composer-2.5 defaults to fast=true at ~4x
 * base rates, claude-haiku-4-5 to thinking=true), and that default follows
 * an out-of-band account setting. This module pins every user-selectable
 * variant parameter the model declares, so the served variant is a
 * deterministic function of the execution config:
 *
 * - fast: pinned from ExecutionConfig.service_tier (FAST → true).
 *   Price-bearing — the fast variant bills at pricingVariants.fast rates.
 * - thinking: pinned from ExecutionConfig.thinking_mode (ENABLED → true).
 *   Per-token price-neutral (ledger-verified 2026-08-15: thinking wire ids
 *   bill exactly base rates; thinking+fast bills exactly the fast rate) —
 *   pinned anyway because the served variant must never follow the account
 *   default, and ENABLED turns consume more output (reasoning) tokens.
 * - Parameters that are neither (e.g. effort) are deliberately NOT pinned —
 *   they follow the catalog default and do not change the bill.
 *
 * Parameter bundles come from Cursor.models.list() (worker-cached): the
 * catalog is the only source of a model's parameter ids, and the fetch
 * rides the same proxy fetch-interceptor as every other SDK call, so it
 * works identically in proxy and direct modes.
 *
 * The harness-neutral halves — the enum semantics and the single
 * UNSPECIFIED→default resolution points — live in `shared/service-tier.ts`
 * (since #361 extended tiers to the native harness) and
 * `shared/thinking-mode.ts`; this module keeps only the Cursor-catalog
 * translation.
 */

import { Cursor } from "@cursor/sdk";
import type { ModelListItem, ModelParameterValue } from "@cursor/sdk";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { serviceTierLabel, type EffectiveServiceTier } from "../../shared/service-tier.js";
import { thinkingModeLabel, type EffectiveThinkingMode } from "../../shared/thinking-mode.js";

/**
 * Catalog ids that mean "Cursor picks the model" (Auto). Auto's single
 * catalog variant has an empty parameter set — there is no tier dimension
 * to pin, a documented v1 limitation. Create-time validation refuses FAST
 * without a pinned model, so FAST can only reach Auto through registry
 * drift — handled as a loud failure below.
 */
const AUTO_MODEL_IDS = new Set(["default", "auto"]);

/**
 * The user-selectable variant parameter ids. Pinning exactly these keeps
 * the served variant deterministic while leaving effort knobs on their
 * catalog defaults. `fast` changes the per-token price; `thinking` is
 * price-neutral but changes token consumption and must never follow the
 * account default. Sourced from the Cursor catalog survey
 * (stigmer-cloud _projects/2026-08/20260806.04.model-service-tier).
 */
const FAST_PARAM_ID = "fast";
const THINKING_PARAM_ID = "thinking";

const CATALOG_CACHE_TTL_MS = 3_600_000; // 1 hour, matching the pricing table TTL

interface CatalogCache {
  readonly apiKey: string;
  readonly models: readonly ModelListItem[];
  readonly expiresAt: number;
}

let catalogCache: CatalogCache | null = null;
// Keyed by apiKey: a worker normally serves one org's key, but nothing
// enforces that — handing execution A a catalog fetched under execution B's
// key would leak another account's model availability into A's translation.
let inflightCatalogFetch: { readonly apiKey: string; readonly promise: Promise<readonly ModelListItem[]> } | null = null;

/** Test-only: drop the worker-level catalog cache. */
export function resetCatalogCacheForTests(): void {
  catalogCache = null;
  inflightCatalogFetch = null;
}

async function listCatalogModels(apiKey: string): Promise<readonly ModelListItem[]> {
  const now = Date.now();
  if (catalogCache && catalogCache.apiKey === apiKey && catalogCache.expiresAt > now) {
    return catalogCache.models;
  }
  if (inflightCatalogFetch?.apiKey === apiKey) return inflightCatalogFetch.promise;

  let entry: { apiKey: string; promise: Promise<readonly ModelListItem[]> } | null = null;
  const promise = (async () => {
    try {
      const models = await Cursor.models.list({ apiKey });
      catalogCache = { apiKey, models, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
      return models;
    } finally {
      // Clear only our own entry — a concurrent fetch under another key may
      // have replaced it.
      if (inflightCatalogFetch === entry) {
        inflightCatalogFetch = null;
      }
    }
  })();
  entry = { apiKey, promise };
  inflightCatalogFetch = entry;
  return promise;
}

function findCatalogModel(
  models: readonly ModelListItem[],
  modelId: string,
): ModelListItem | undefined {
  return models.find((m) => m.id === modelId || m.aliases?.includes(modelId));
}

export interface ResolveServiceTierParamsOptions {
  readonly apiKey: string;
  /** Validated model id the execution runs on (may be "default" for Auto). */
  readonly modelId: string;
  readonly tier: EffectiveServiceTier;
  readonly thinking: EffectiveThinkingMode;
  /** For log correlation only. */
  readonly executionId: string;
}

/**
 * Translate the effective tier + thinking mode into the explicit variant
 * parameters to send with every Agent.create/resume for this execution.
 *
 * Fail-closed posture: an ACTIVE selection (FAST tier, ENABLED thinking)
 * with no pinnable dimension is an error, never a silent downgrade —
 * create-time validation makes this unreachable unless the registry and the
 * provider catalog have drifted, and that drift must be heard about, not
 * absorbed.
 *
 * The base selection (STANDARD + DISABLED) degrades to empty params on
 * catalog failures rather than failing the execution — but be clear about
 * what that costs: an unpinned selection falls to the catalog default
 * variant, which for several models IS the fast/thinking variant (the
 * incident this module exists to prevent). Failing every base execution
 * whenever the catalog endpoint blips would be the worse trade; the WARN
 * below plus billing's requested-vs-billed mismatch alarms (which catch
 * exactly this window) are the compensating controls.
 */
export async function resolveServiceTierParams(
  options: ResolveServiceTierParamsOptions,
): Promise<ModelParameterValue[]> {
  const { apiKey, modelId, tier, thinking, executionId } = options;
  const tierName = serviceTierLabel(tier);
  const thinkingName = thinkingModeLabel(thinking);
  // Selections that actively deviate from the base variant must fail loudly
  // when they cannot be pinned; the base selection may degrade with a WARN.
  const active: string[] = [];
  if (tier === ServiceTier.FAST) active.push("service_tier=fast");
  if (thinking === ThinkingMode.ENABLED) active.push("thinking=enabled");

  if (AUTO_MODEL_IDS.has(modelId)) {
    if (active.length > 0) {
      throw new Error(
        `${active.join(" + ")} requires a pinned model — Auto ("${modelId}") has ` +
        `no variant dimensions. Execution ${executionId} should have been ` +
        `refused at create time; the model registry and provider catalog may ` +
        `have drifted.`,
      );
    }
    console.log(
      `VariantParams: execution=${executionId} model=${modelId} tier=${tierName} ` +
      `thinking=${thinkingName} — Auto has no variant parameters; Cursor picks ` +
      `the model and variant (documented v1 limitation).`,
    );
    return [];
  }

  let models: readonly ModelListItem[];
  try {
    models = await listCatalogModels(apiKey);
  } catch (err) {
    if (active.length > 0) {
      throw new Error(
        `${active.join(" + ")} for execution ${executionId} needs the Cursor ` +
        `model catalog to resolve variant params for "${modelId}", and the ` +
        `catalog fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    console.warn(
      `VariantParams UNPINNED: execution=${executionId} model=${modelId} tier=${tierName} ` +
      `thinking=${thinkingName} — catalog fetch failed ` +
      `(${err instanceof Error ? err.message : err}); sending no variant params, ` +
      `so the catalog DEFAULT variant decides the served variant for this ` +
      `execution (fast/thinking on several models — the expensive direction). ` +
      `Billing's requested-vs-billed mismatch alarms cover this window.`,
    );
    return [];
  }

  const model = findCatalogModel(models, modelId);
  if (!model) {
    if (active.length > 0) {
      throw new Error(
        `${active.join(" + ")} requested for "${modelId}" (execution ${executionId}) ` +
        `but the Cursor catalog does not list that model — cannot pin its ` +
        `variant parameters. The model registry and provider catalog have drifted.`,
      );
    }
    console.warn(
      `VariantParams UNPINNED: execution=${executionId} model=${modelId} tier=${tierName} ` +
      `thinking=${thinkingName} — model not in the Cursor catalog; sending no ` +
      `variant params, so the catalog DEFAULT variant decides the served ` +
      `variant for this execution.`,
    );
    return [];
  }

  const params: ModelParameterValue[] = [];
  for (const def of model.parameters ?? []) {
    if (def.id === FAST_PARAM_ID) {
      params.push({ id: FAST_PARAM_ID, value: tier === ServiceTier.FAST ? "true" : "false" });
    } else if (def.id === THINKING_PARAM_ID) {
      params.push({
        id: THINKING_PARAM_ID,
        value: thinking === ThinkingMode.ENABLED ? "true" : "false",
      });
    }
    // Any other parameter (e.g. effort) is price-neutral and not
    // user-selectable: left to the catalog default variant on purpose.
  }

  if (tier === ServiceTier.FAST && !params.some((p) => p.id === FAST_PARAM_ID)) {
    throw new Error(
      `service_tier=fast requested for "${modelId}" (execution ${executionId}) ` +
      `but the Cursor catalog declares no "fast" parameter for it. The model ` +
      `registry prices a fast variant the provider no longer offers — refusing ` +
      `rather than silently billing an unknown variant.`,
    );
  }

  if (thinking === ThinkingMode.ENABLED && !params.some((p) => p.id === THINKING_PARAM_ID)) {
    throw new Error(
      `thinking=enabled requested for "${modelId}" (execution ${executionId}) ` +
      `but the Cursor catalog declares no "thinking" parameter for it. The ` +
      `model registry claims a thinking capability the provider no longer ` +
      `offers — refusing rather than silently serving the base variant.`,
    );
  }

  params.sort((a, b) => a.id.localeCompare(b.id));
  console.log(
    `VariantParams: execution=${executionId} model=${modelId} tier=${tierName} ` +
    `thinking=${thinkingName} params=${JSON.stringify(params)}`,
  );
  return params;
}
