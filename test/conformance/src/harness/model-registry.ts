// Reads the model registry document a control plane serves at
// /v1/proxy/model-registry — the same document the runner fetches to resolve a
// registry id to a provider api id (runner shared/model-registry.ts).
// Domain: conformance harness (execution engine).
//
// The harness reads only the fields the arms compare on — the id pair for
// resolution and the three the runner's economy-tier pick keys on — so
// registry schema growth (pricing, capabilities) never touches this module. A
// document with no `models` array is refused by name: the arms would otherwise
// "pass" against an empty registry exactly the way the runner silently
// degrades against one.
export interface ModelRegistryRow {
  id: string;
  apiModelId: string | undefined;
  provider: string | undefined;
  costTier: string | undefined;
  harness: string | undefined;
}

export interface ModelRegistryDocument {
  models: ModelRegistryRow[];
}

// Fetches and parses the document from `origin`, sending `headers` (the bearer
// the cloud lane requires; nothing on the OSS unified port).
export async function fetchModelRegistryDocument(
  origin: string,
  headers: Record<string, string> = {},
): Promise<ModelRegistryDocument> {
  const url = `${origin.replace(/\/+$/, "")}/v1/proxy/model-registry`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`model registry at ${url} answered HTTP ${response.status}`);
  }
  return parseModelRegistryDocument(await response.json(), url);
}

// Pure; the unit arm pins the shape guard.
export function parseModelRegistryDocument(json: unknown, source = "(inline)"): ModelRegistryDocument {
  const models = (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) {
    throw new Error(`model registry at ${source} carries no models array`);
  }
  return {
    models: models.flatMap((row): ModelRegistryRow[] => {
      const id = (row as { id?: unknown } | null)?.id;
      if (typeof id !== "string") return [];
      const text = (key: "apiModelId" | "provider" | "costTier" | "harness"): string | undefined => {
        const value = (row as Record<string, unknown>)[key];
        return typeof value === "string" ? value : undefined;
      };
      return [{ id, apiModelId: text("apiModelId"), provider: text("provider"), costTier: text("costTier"), harness: text("harness") }];
    }),
  };
}

// The row for a registry id, or a named failure — an arm that pins a model the
// registry no longer carries must fail on the registry, not on the wire.
export function requireRegistryRow(document: ModelRegistryDocument, id: string): ModelRegistryRow {
  const row = document.models.find((model) => model.id === id);
  if (row === undefined) {
    throw new Error(`model registry has no row with id ${JSON.stringify(id)} (${document.models.length} rows)`);
  }
  return row;
}

// The row the runner's economy-tier pick lands on for `provider` (runner
// shared/model-registry.ts getEconomyModel: the FIRST row with that provider,
// costTier "economy" and harness "native"; the cross-provider fallback is any
// such row). Mirrors the runner's order so the classifier and summarization
// arms assert the model the runner actually chose, read off the same document.
export function economyRowFor(document: ModelRegistryDocument, provider: string): ModelRegistryRow {
  const economy = (row: ModelRegistryRow): boolean => row.costTier === "economy" && row.harness === "native";
  const row =
    document.models.find((model) => model.provider === provider && economy(model)) ??
    document.models.find(economy);
  if (row === undefined) {
    throw new Error(`model registry has no economy-tier native row (provider ${JSON.stringify(provider)} or any)`);
  }
  return row;
}

// The id a resolved row puts on the wire: its apiModelId, else its id (the
// runner's identity fallback for rows without one).
export function wireModelIdOf(row: ModelRegistryRow): string {
  return row.apiModelId ?? row.id;
}
