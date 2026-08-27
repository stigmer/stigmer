/**
 * Document-driven ModelCatalogProvider — the registry-document
 * interpretation extracted from ModelRegistryStore (C1 seam request,
 * 20260827.04; DD-008's "validation logic stays OSS and edition-neutral"
 * applied to the interpretation itself).
 *
 * Why the extraction exists: a composition whose catalog comes from
 * somewhere other than the bundled-snapshot-plus-upstream-refresh
 * lifecycle (the cloud's DB-resident operator baseline) still needs the
 * IDENTICAL document semantics — the sanity gate, apiModelId acceptance,
 * the tri-state capability rule, the sorted suggestion pools. Before this
 * module those semantics were private to ModelRegistryStore, so any other
 * provider implementation had to fork them and drift silently. Now the
 * interpretation lives here exactly once: ModelRegistryStore delegates to
 * it per document swap, and compositions build their own providers from
 * documents via newModelCatalogProviderFromDocument (exported through the
 * DD-005 map).
 *
 * The interpretation is byte-identical to the pre-extraction store (which
 * ported Go's applyDocument, model_registry_store.go:302-412): both
 * canonical ids and provider api ids validate (oss#240); pricing-variant
 * VALUES are not modeled, only the key set; capability values declare
 * only on literal `true` (the tri-state rule — absence is "unknown").
 */
import type { ModelCatalogProvider } from "./model-catalog-provider.js";

/**
 * The subset of a registry entry the catalog indexes (Go
 * modelRegistryEntry). See the module header for the acceptance rules.
 */
interface ModelRegistryEntry {
  id?: unknown;
  harness?: unknown;
  apiModelId?: unknown;
  pricingVariants?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

/** The derived valid-model indexes, built once per document. */
interface RegistryIndexes {
  /** harness → model reference (canonical or api id) → true. */
  modelsByHarness: Map<string, Set<string>>;
  /** harness → sorted canonical ids (suggestion pools; may repeat a
   *  duplicated document entry, exactly as Go's per-harness list does). */
  sortedModelsByHarness: Map<string, string[]>;
  /** variant → harness → model reference → true (oss#357). */
  modelsByVariant: Map<string, Map<string, Set<string>>>;
  /** variant → sorted deduped canonical ids across harnesses. */
  sortedModelsByVariant: Map<string, string[]>;
  /** variant → harness → sorted canonical ids. */
  sortedModelsByVariantHarness: Map<string, Map<string, string[]>>;
  /** capability → harness → model reference → true (oss#772). */
  modelsByCapability: Map<string, Map<string, Set<string>>>;
  /** capability → harness → sorted canonical ids. */
  sortedModelsByCapabilityHarness: Map<string, Map<string, string[]>>;
}

/**
 * A ModelCatalogProvider over one parsed document. Immutable after
 * construction — a source with a refresh lifecycle (ModelRegistryStore's
 * hourly upstream pull, a DB-resident baseline's reload) builds a fresh
 * catalog per accepted document and swaps atomically, so a reader never
 * sees a document whose indexes describe a different registry.
 */
export class DocumentModelCatalog implements ModelCatalogProvider {
  private constructor(
    private readonly registryDocument: string,
    private readonly indexes: RegistryIndexes,
  ) {}

  /**
   * Builds a catalog, or undefined when the document fails the sanity
   * gate: it must parse AND index at least one model entry ($comment
   * section dividers carry no id/harness and index nothing, so a
   * divider-only document is as unusable as an empty one).
   */
  static tryBuild(document: string): DocumentModelCatalog | undefined {
    const indexes = buildIndexes(document);
    if (indexes === undefined) {
      return undefined;
    }
    return new DocumentModelCatalog(document, indexes);
  }

  document(): string {
    return this.registryDocument;
  }

  isValidModel(harness: string, model: string): boolean {
    return this.indexes.modelsByHarness.get(harness)?.has(model) ?? false;
  }

  hasHarness(harness: string): boolean {
    return (this.indexes.modelsByHarness.get(harness)?.size ?? 0) > 0;
  }

  hasAnyModels(): boolean {
    return this.indexes.modelsByHarness.size > 0;
  }

  isValidModelOnAnyHarness(model: string): boolean {
    for (const models of this.indexes.modelsByHarness.values()) {
      if (models.has(model)) {
        return true;
      }
    }
    return false;
  }

  /** Computed per call (refusal-path only). */
  canonicalModelsAcrossHarnesses(): string[] {
    const seen = new Set<string>();
    for (const models of this.indexes.sortedModelsByHarness.values()) {
      for (const name of models) {
        seen.add(name);
      }
    }
    return [...seen].sort();
  }

  canonicalModels(harness: string): string[] {
    return this.indexes.sortedModelsByHarness.get(harness) ?? [];
  }

  hasPricingVariant(model: string, variant: string): boolean {
    const byHarness = this.indexes.modelsByVariant.get(variant);
    if (byHarness === undefined) {
      return false;
    }
    for (const refs of byHarness.values()) {
      if (refs.has(model)) {
        return true;
      }
    }
    return false;
  }

  hasPricingVariantForHarness(
    harness: string,
    model: string,
    variant: string,
  ): boolean {
    return (
      this.indexes.modelsByVariant.get(variant)?.get(harness)?.has(model) ??
      false
    );
  }

  canonicalModelsWithVariant(variant: string): string[] {
    return this.indexes.sortedModelsByVariant.get(variant) ?? [];
  }

  canonicalModelsWithVariantForHarness(
    harness: string,
    variant: string,
  ): string[] {
    return (
      this.indexes.sortedModelsByVariantHarness.get(variant)?.get(harness) ?? []
    );
  }

  hasCapabilityForHarness(
    harness: string,
    model: string,
    capability: string,
  ): boolean {
    return (
      this.indexes.modelsByCapability.get(capability)?.get(harness)?.has(model) ??
      false
    );
  }

  canonicalModelsWithCapabilityForHarness(
    harness: string,
    capability: string,
  ): string[] {
    return (
      this.indexes.sortedModelsByCapabilityHarness
        .get(capability)
        ?.get(harness) ?? []
    );
  }
}

/**
 * The exported constructor (DD-005 map): a provider over one document,
 * for compositions whose catalog source is their own (the cloud's
 * DB-resident baseline). Loud-fail by contract — a document that fails
 * the sanity gate throws, because a composition-supplied catalog that
 * indexes nothing is a wiring bug, not a degraded mode (the bundled-
 * snapshot fallback is ModelRegistryStore's lifecycle, not this one's).
 */
export function newModelCatalogProviderFromDocument(
  document: string,
): ModelCatalogProvider {
  const catalog = DocumentModelCatalog.tryBuild(document);
  if (catalog === undefined) {
    throw new Error(
      "model-registry document is invalid or indexes no models",
    );
  }
  return catalog;
}

/**
 * Parses a registry document and derives the valid-model indexes — the TS
 * half of Go's applyDocument (:302-412). Returns undefined when the
 * document fails the sanity gate.
 */
function buildIndexes(document: string): RegistryIndexes | undefined {
  let parsed: { models?: unknown };
  try {
    parsed = JSON.parse(document) as { models?: unknown };
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed.models)) {
    return undefined;
  }

  const modelsByHarness = new Map<string, Set<string>>();
  const sortedModelsByHarness = new Map<string, string[]>();
  const modelsByVariant = new Map<string, Map<string, Set<string>>>();
  // Set-backed: the same canonical id may price a variant under more than
  // one harness, and the union list must not repeat it.
  const canonicalByVariantSet = new Map<string, Set<string>>();
  const sortedModelsByVariantHarness = new Map<string, Map<string, string[]>>();
  const modelsByCapability = new Map<string, Map<string, Set<string>>>();
  const sortedModelsByCapabilityHarness = new Map<
    string,
    Map<string, string[]>
  >();

  for (const raw of parsed.models as ModelRegistryEntry[]) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : "";
    const harness = typeof raw.harness === "string" ? raw.harness : "";
    if (id === "" || harness === "") {
      continue;
    }
    const apiModelId =
      typeof raw.apiModelId === "string" ? raw.apiModelId : "";

    mapSet(modelsByHarness, harness).add(id);
    mapList(sortedModelsByHarness, harness).push(id);
    if (apiModelId !== "") {
      mapSet(modelsByHarness, harness).add(apiModelId);
    }

    if (raw.pricingVariants !== null && typeof raw.pricingVariants === "object") {
      for (const variant of Object.keys(raw.pricingVariants)) {
        const byHarness = mapMap(modelsByVariant, variant);
        mapSet(byHarness, harness).add(id);
        if (apiModelId !== "") {
          mapSet(byHarness, harness).add(apiModelId);
        }
        mapSet(canonicalByVariantSet, variant).add(id);
        mapList(mapMapList(sortedModelsByVariantHarness, variant), harness).push(id);
      }
    }

    if (raw.capabilities !== null && typeof raw.capabilities === "object") {
      for (const [capability, value] of Object.entries(raw.capabilities)) {
        // Only literal `true` declares the capability; false, null, or a
        // future non-boolean shape indexes nothing (tri-state rule:
        // absence is "unknown", never a claim either way).
        if (value !== true) {
          continue;
        }
        const byHarness = mapMap(modelsByCapability, capability);
        mapSet(byHarness, harness).add(id);
        if (apiModelId !== "") {
          mapSet(byHarness, harness).add(apiModelId);
        }
        mapList(mapMapList(sortedModelsByCapabilityHarness, capability), harness).push(id);
      }
    }
  }

  if (modelsByHarness.size === 0) {
    return undefined;
  }

  for (const ids of sortedModelsByHarness.values()) {
    ids.sort();
  }
  const sortedModelsByVariant = new Map<string, string[]>();
  for (const [variant, idSet] of canonicalByVariantSet) {
    sortedModelsByVariant.set(variant, [...idSet].sort());
  }
  for (const byHarness of sortedModelsByVariantHarness.values()) {
    for (const ids of byHarness.values()) {
      ids.sort();
    }
  }
  for (const byHarness of sortedModelsByCapabilityHarness.values()) {
    for (const ids of byHarness.values()) {
      ids.sort();
    }
  }

  return {
    modelsByHarness,
    sortedModelsByHarness,
    modelsByVariant,
    sortedModelsByVariant,
    sortedModelsByVariantHarness,
    modelsByCapability,
    sortedModelsByCapabilityHarness,
  };
}

function mapSet(m: Map<string, Set<string>>, key: string): Set<string> {
  let v = m.get(key);
  if (v === undefined) {
    v = new Set();
    m.set(key, v);
  }
  return v;
}

function mapList(m: Map<string, string[]>, key: string): string[] {
  let v = m.get(key);
  if (v === undefined) {
    v = [];
    m.set(key, v);
  }
  return v;
}

function mapMap(
  m: Map<string, Map<string, Set<string>>>,
  key: string,
): Map<string, Set<string>> {
  let v = m.get(key);
  if (v === undefined) {
    v = new Map();
    m.set(key, v);
  }
  return v;
}

function mapMapList(
  m: Map<string, Map<string, string[]>>,
  key: string,
): Map<string, string[]> {
  let v = m.get(key);
  if (v === undefined) {
    v = new Map();
    m.set(key, v);
  }
  return v;
}
