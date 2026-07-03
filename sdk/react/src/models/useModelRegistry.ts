"use client";

import { useMemo } from "react";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  resolveDefaultModelId,
  modelKey,
  type ModelInfo,
  type Provider,
} from "./registry.js";
import type { HarnessOption } from "./harness.js";
import { useModelRegistryContext } from "./ModelRegistryContext.js";

/** Options for {@link useModelRegistry}. */
export interface UseModelRegistryOptions {
  /**
   * Restrict to a single harness.
   *
   * - `"cursor"` — only Cursor-harness models, default → {@link DEFAULT_CURSOR_MODEL_ID}
   * - `"native"` — only native-harness models, filtered by {@link DISABLED_PROVIDERS}
   * - omitted — **unified mode**: all enabled models from both harnesses
   */
  readonly harness?: HarnessOption;
}

/** Return value of {@link useModelRegistry}. */
export interface UseModelRegistryReturn {
  /** All enabled models for the selected mode. */
  readonly models: readonly ModelInfo[];
  /** Models grouped by provider for sectioned rendering. */
  readonly byProvider: ReadonlyMap<Provider, readonly ModelInfo[]>;
  /** The platform default model for the current mode. `undefined` while the registry is loading. */
  readonly defaultModel: ModelInfo | undefined;
  /**
   * Look up a single model by its `modelId`.
   *
   * In unified mode the same modelId can exist under both harnesses
   * (e.g. `claude-sonnet-4.5` on native and `claude-4.5-sonnet` on cursor).
   * This returns the first match. Use {@link getByKey} with a compound key
   * for an unambiguous lookup.
   */
  readonly getModel: (modelId: string) => ModelInfo | undefined;
  /** Ordered list of enabled provider identifiers. */
  readonly providers: readonly Provider[];
  /** Curated subset of models marked as `featured` in the registry. */
  readonly featured: readonly ModelInfo[];
  /**
   * Look up a model by its compound key (`"native/claude-sonnet-4.6"`).
   * Always unambiguous, even in unified mode.
   */
  readonly getByKey: (key: string) => ModelInfo | undefined;
  /** `true` while the model registry is being fetched from the API. */
  readonly isLoading: boolean;
  /** Non-null if the API fetch failed. Models will be empty in this case. */
  readonly error: Error | null;
  /** Retry fetching the model registry. No-op while a fetch is in flight. */
  readonly refetch: () => void;
}

/**
 * Data hook that exposes the platform model registry with grouping
 * and lookup helpers.
 *
 * Pure data layer — no rendering, no side effects. Platform builders
 * who want full control over rendering import this hook and build
 * their own UI.
 *
 * The model data is fetched from the public model registry API by
 * {@link StigmerProvider} and cached in context. During loading,
 * `isLoading` is `true` and `models` is empty.
 *
 * **Modes:**
 * - `options.harness === "cursor"` — Cursor-harness models only
 * - `options.harness === "native"` — native models, excluding disabled providers
 * - `options.harness` omitted — unified: both harnesses, excluding disabled providers
 *
 * @example
 * ```tsx
 * // Unified mode — flat picker with all models
 * const { featured, models, getByKey, isLoading } = useModelRegistry();
 *
 * // Legacy single-harness mode
 * const { models, defaultModel } = useModelRegistry({ harness: "native" });
 * ```
 */
export function useModelRegistry(options?: UseModelRegistryOptions): UseModelRegistryReturn {
  const harness = options?.harness;
  const { models: allModels, isLoading, error, refetch } = useModelRegistryContext();

  return useMemo(() => {
    const isUnified = harness === undefined;
    const { modelId: defaultId } = harness
      ? resolveDefaultModelId(harness, allModels)
      : { modelId: DEFAULT_MODEL_ID };

    const byProvider = new Map<Provider, ModelInfo[]>();
    const byId = new Map<string, ModelInfo>();
    const byCompoundKey = new Map<string, ModelInfo>();
    const enabledModels: ModelInfo[] = [];
    const featuredModels: ModelInfo[] = [];
    let defaultModel: ModelInfo | undefined;

    for (const model of allModels) {
      if (isUnified) {
        if (DISABLED_PROVIDERS.has(model.provider)) continue;
      } else {
        if (model.harness !== harness) continue;
        if (DISABLED_PROVIDERS.has(model.provider)) continue;
      }

      enabledModels.push(model);
      byCompoundKey.set(modelKey(model.harness, model.modelId), model);

      if (!byId.has(model.modelId)) {
        byId.set(model.modelId, model);
      }

      const group = byProvider.get(model.provider);
      if (group) {
        group.push(model);
      } else {
        byProvider.set(model.provider, [model]);
      }

      if (model.modelId === defaultId) {
        defaultModel ??= model;
      }

      if (model.featured) {
        featuredModels.push(model);
      }
    }

    const providers = Array.from(byProvider.keys());

    return {
      models: enabledModels,
      byProvider: byProvider as ReadonlyMap<Provider, readonly ModelInfo[]>,
      defaultModel: defaultModel ?? enabledModels[0],
      getModel: (modelId: string) => byId.get(modelId),
      providers,
      featured: featuredModels,
      getByKey: (key: string) => byCompoundKey.get(key),
      isLoading,
      error,
      refetch,
    };
  }, [harness, allModels, isLoading, error, refetch]);
}
