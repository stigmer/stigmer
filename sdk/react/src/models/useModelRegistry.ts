"use client";

import { useMemo } from "react";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DEFAULT_CURSOR_MODEL_ID,
  DISABLED_PROVIDERS,
  type ModelInfo,
  type Provider,
} from "./registry";
import type { HarnessOption } from "./harness";

/** Options for {@link useModelRegistry}. */
export interface UseModelRegistryOptions {
  /**
   * When `"cursor"`, only Cursor-provider models are shown and the
   * default model switches to {@link DEFAULT_CURSOR_MODEL_ID}.
   * When `"native"` or omitted, current behavior applies
   * ({@link DISABLED_PROVIDERS} are filtered out).
   */
  readonly harness?: HarnessOption;
}

/** Return value of {@link useModelRegistry}. */
export interface UseModelRegistryReturn {
  /** All enabled models, filtered to exclude {@link DISABLED_PROVIDERS}. */
  readonly models: readonly ModelInfo[];
  /** Models grouped by provider for sectioned rendering. */
  readonly byProvider: ReadonlyMap<Provider, readonly ModelInfo[]>;
  /** The platform default model, resolved from {@link DEFAULT_MODEL_ID}. */
  readonly defaultModel: ModelInfo;
  /** Look up a single model by its `modelId`. Returns `undefined` for unknown or disabled models. */
  readonly getModel: (modelId: string) => ModelInfo | undefined;
  /** Ordered list of enabled provider identifiers. */
  readonly providers: readonly Provider[];
}

/**
 * Data hook that exposes the platform model registry with grouping
 * and lookup helpers.
 *
 * Pure data layer — no rendering, no side effects. Platform builders
 * who want full control over rendering import this hook and build
 * their own UI.
 *
 * When `options.harness` is `"cursor"`, the registry shows only
 * Cursor-provider models. Otherwise, {@link DISABLED_PROVIDERS} are
 * filtered out (default behavior).
 *
 * @example
 * ```tsx
 * function CustomModelPicker({ onSelect }: { onSelect: (id: string) => void }) {
 *   const { models, byProvider, defaultModel, getModel } = useModelRegistry();
 *
 *   return (
 *     <select
 *       defaultValue={defaultModel.modelId}
 *       onChange={(e) => onSelect(e.target.value)}
 *     >
 *       {models.map((m) => (
 *         <option key={m.modelId} value={m.modelId}>
 *           {m.displayName} ({m.costTier})
 *         </option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
export function useModelRegistry(options?: UseModelRegistryOptions): UseModelRegistryReturn {
  const harness = options?.harness;

  return useMemo(() => {
    const isCursor = harness === "cursor";
    const defaultId = isCursor ? DEFAULT_CURSOR_MODEL_ID : DEFAULT_MODEL_ID;

    const byProvider = new Map<Provider, ModelInfo[]>();
    const byId = new Map<string, ModelInfo>();
    const enabledModels: ModelInfo[] = [];
    let defaultModel: ModelInfo | undefined;

    for (const model of MODEL_REGISTRY) {
      if (isCursor) {
        if (model.provider !== "cursor") continue;
      } else {
        if (DISABLED_PROVIDERS.has(model.provider)) continue;
      }

      enabledModels.push(model);
      byId.set(model.modelId, model);

      const group = byProvider.get(model.provider);
      if (group) {
        group.push(model);
      } else {
        byProvider.set(model.provider, [model]);
      }

      if (model.modelId === defaultId) {
        defaultModel = model;
      }
    }

    const providers = Array.from(byProvider.keys());

    return {
      models: enabledModels,
      byProvider: byProvider as ReadonlyMap<Provider, readonly ModelInfo[]>,
      defaultModel: defaultModel ?? enabledModels[0],
      getModel: (modelId: string) => byId.get(modelId),
      providers,
    };
  }, [harness]);
}
