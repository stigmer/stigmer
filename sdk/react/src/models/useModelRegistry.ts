"use client";

import { useMemo } from "react";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  modelKey,
  type ModelInfo,
  type Provider,
} from "./registry";
import type { HarnessOption } from "./harness";

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
  /** The platform default model for the current mode. */
  readonly defaultModel: ModelInfo;
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
}

/**
 * Data hook that exposes the platform model registry with grouping
 * and lookup helpers.
 *
 * Pure data layer — no rendering, no side effects. Platform builders
 * who want full control over rendering import this hook and build
 * their own UI.
 *
 * **Modes:**
 * - `options.harness === "cursor"` — Cursor-harness models only
 * - `options.harness === "native"` — native models, excluding disabled providers
 * - `options.harness` omitted — unified: both harnesses, excluding disabled providers
 *
 * @example
 * ```tsx
 * // Unified mode — flat picker with all models
 * const { featured, models, getByKey } = useModelRegistry();
 *
 * // Legacy single-harness mode
 * const { models, defaultModel } = useModelRegistry({ harness: "native" });
 * ```
 */
export function useModelRegistry(options?: UseModelRegistryOptions): UseModelRegistryReturn {
  const harness = options?.harness;

  return useMemo(() => {
    const isCursor = harness === "cursor";
    const isNative = harness === "native";
    const isUnified = harness === undefined;
    const defaultId = isCursor ? DEFAULT_CURSOR_MODEL_ID : DEFAULT_MODEL_ID;

    const byProvider = new Map<Provider, ModelInfo[]>();
    const byId = new Map<string, ModelInfo>();
    const byCompoundKey = new Map<string, ModelInfo>();
    const enabledModels: ModelInfo[] = [];
    const featuredModels: ModelInfo[] = [];
    let defaultModel: ModelInfo | undefined;

    for (const model of MODEL_REGISTRY) {
      if (isCursor) {
        if (model.harness !== "cursor") continue;
      } else if (isNative) {
        if (model.harness !== "native") continue;
        if (DISABLED_PROVIDERS.has(model.provider)) continue;
      } else {
        // Unified — include both harnesses, still respect DISABLED_PROVIDERS
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
    };
  }, [harness]);
}
