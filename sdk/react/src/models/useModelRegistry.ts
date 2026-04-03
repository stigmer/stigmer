"use client";

import { useMemo } from "react";
import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  DISABLED_PROVIDERS,
  type ModelInfo,
  type Provider,
} from "./registry";

export interface UseModelRegistryReturn {
  readonly models: readonly ModelInfo[];
  readonly byProvider: ReadonlyMap<Provider, readonly ModelInfo[]>;
  readonly defaultModel: ModelInfo;
  readonly getModel: (modelId: string) => ModelInfo | undefined;
  readonly providers: readonly Provider[];
}

/**
 * Data hook that exposes the platform model registry with grouping
 * and lookup helpers.
 *
 * Pure data layer — no rendering, no side effects. Platform builders
 * who want full control over rendering import this hook and build
 * their own UI.
 */
export function useModelRegistry(): UseModelRegistryReturn {
  return useMemo(() => {
    const byProvider = new Map<Provider, ModelInfo[]>();
    const byId = new Map<string, ModelInfo>();
    const enabledModels: ModelInfo[] = [];
    let defaultModel: ModelInfo | undefined;

    for (const model of MODEL_REGISTRY) {
      if (DISABLED_PROVIDERS.has(model.provider)) continue;

      enabledModels.push(model);
      byId.set(model.modelId, model);

      const group = byProvider.get(model.provider);
      if (group) {
        group.push(model);
      } else {
        byProvider.set(model.provider, [model]);
      }

      if (model.modelId === DEFAULT_MODEL_ID) {
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
  }, []);
}
