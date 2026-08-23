/**
 * Model-registry document store — ports the Go server's ModelRegistryStore
 * (pkg/domain/workflow/registry/model_registry_store.go). Domain-owned, as
 * in Go: the workflow validators and the transport's /v1/proxy/model-registry
 * lane read this ONE store, so the document the pickers see and the set
 * validation accepts can never drift (DD-004). Sub-project #3 first landed
 * the serving/refresh half under src/transport/; the workflow-family port
 * moved it home and added the catalog indexes (sub-project DD-A).
 *
 * The store always holds a complete, valid document: it starts from the
 * bundled build-time snapshot (offline-install contract — a server with no
 * outbound network still answers a full registry) and upgrades in place
 * from the hosted API. Every transition is guarded by the same sanity gate
 * Go applies (applyDocument, :299-306): the candidate must parse and index
 * at least one model entry, otherwise it is rejected and the current
 * document stays — a bad upstream can never blank the console's model
 * pickers or turn model validation into reject-everything.
 *
 * Failure logging matches Go (:454-476): the FIRST consecutive refresh
 * failure logs at warn, repeats at debug until a success resets the flag —
 * an offline laptop must not fill its log with hourly warnings.
 */
import type { Logger } from "../../../boot/logger.js";

/** Upstream refresh cadence (Go modelRegistryRefreshInterval, :34). */
export const MODEL_REGISTRY_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Per-fetch budget (Go fetch timeout, :35-39). */
export const MODEL_REGISTRY_FETCH_TIMEOUT_MS = 30_000;

/**
 * Read cap on the upstream body (Go's 8<<20 limited reader). Go truncates
 * the stream and lets the parse fail; here the size check rejects before
 * parsing — same outcome (oversized document rejected, current kept).
 */
export const MODEL_REGISTRY_MAX_BYTES = 8 * 1024 * 1024;

/** Hosted API path appended to the upstream origin (Go :20-32). */
export const MODEL_REGISTRY_UPSTREAM_PATH = "/api/v1/public/model-registry";

/**
 * The registry pricing-variant key backing SERVICE_TIER_FAST (oss#357) —
 * the one vocabulary shared by every consumer, defined beside the index it
 * queries so the selectable key and the priced key can never drift.
 */
export const FAST_VARIANT_KEY = "fast";

/**
 * The registry capability key backing THINKING_MODE_ENABLED (oss#772) —
 * defined beside the index it queries so the selectable key and the
 * declared key can never drift.
 */
export const THINKING_CAPABILITY_KEY = "thinking";

export interface ModelRegistryStoreOptions {
  /** Bundled build-time snapshot; MUST pass the sanity gate at boot. */
  bundledDocument: string;
  upstreamOrigin: string;
  refreshEnabled: boolean;
  logger: Logger;
  /** Test seam for the upstream fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The subset of a registry entry the store indexes (Go modelRegistryEntry).
 * Both canonical ids and provider api ids are accepted as valid references
 * because the runner resolves canonical ids via the registry and passes
 * unknown-but-registered api ids to the provider verbatim (oss#240).
 * Pricing-variant VALUES are deliberately not modeled — only the key set
 * matters for capability; capability values are checked for literal `true`
 * only (the tri-state rule: absence is "unknown", never a claim either way).
 */
interface ModelRegistryEntry {
  id?: unknown;
  harness?: unknown;
  apiModelId?: unknown;
  pricingVariants?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

/** The derived valid-model indexes, swapped atomically per document. */
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

export class ModelRegistryStore {
  private currentDocument: string;
  private indexes: RegistryIndexes;
  private refreshTimer: NodeJS.Timeout | undefined;
  private failureLogged = false;
  private readonly options: ModelRegistryStoreOptions;

  constructor(options: ModelRegistryStoreOptions) {
    // A broken bundled snapshot is a build defect, not a runtime condition:
    // fail loud at construction rather than serving an empty registry
    // (Go log.Fatal in Store()).
    const indexes = buildIndexes(options.bundledDocument);
    if (indexes === undefined) {
      throw new Error(
        "bundled model-registry snapshot is invalid or indexes no models",
      );
    }
    this.currentDocument = options.bundledDocument;
    this.indexes = indexes;
    this.options = options;
  }

  /** The served bytes; always complete and valid by construction. */
  document(): string {
    return this.currentDocument;
  }

  /**
   * Whether a model reference (canonical id or provider api id) is
   * executable on the given harness.
   */
  isValidModel(harness: string, model: string): boolean {
    return this.indexes.modelsByHarness.get(harness)?.has(model) ?? false;
  }

  /** Whether the registry knows any models for a harness. */
  hasHarness(harness: string): boolean {
    return (this.indexes.modelsByHarness.get(harness)?.size ?? 0) > 0;
  }

  /**
   * Whether the registry loaded at all — validation degrades to a no-op
   * rather than rejecting everything when it did not.
   */
  hasAnyModels(): boolean {
    return this.indexes.modelsByHarness.size > 0;
  }

  /**
   * Whether a model reference is executable on AT LEAST ONE harness. The
   * existence check for surfaces with no serving harness in this edition
   * (agent channels): a pin no section knows is certainly a typo, while a
   * pin valid anywhere may be right where the spec actually serves.
   */
  isValidModelOnAnyHarness(model: string): boolean {
    for (const models of this.indexes.modelsByHarness.values()) {
      if (models.has(model)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The sorted, deduplicated canonical model ids across every harness
   * section — the did-you-mean candidate pool for the any-harness
   * existence check. Computed per call (refusal-path only).
   */
  canonicalModelsAcrossHarnesses(): string[] {
    const seen = new Set<string>();
    for (const models of this.indexes.sortedModelsByHarness.values()) {
      for (const name of models) {
        seen.add(name);
      }
    }
    return [...seen].sort();
  }

  /**
   * The sorted canonical model ids for a harness (deterministic
   * did-you-mean suggestions — canonical ids are the documented form, so
   * suggestions never surface provider api ids). Callers must not mutate.
   */
  canonicalModels(harness: string): string[] {
    return this.indexes.sortedModelsByHarness.get(harness) ?? [];
  }

  /**
   * Whether a model reference prices the given variant key under ANY
   * harness — the registry-backed capability check for
   * ExecutionConfig.service_tier at execution create (oss#357), which is
   * deliberately harness-free (it never resolves the session).
   */
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

  /**
   * Whether a model reference prices the given variant key under the given
   * harness. The workflow validators use this form — the task config names
   * its harness, so a fast variant priced only under another harness must
   * not validate (it would execute as a silent no-op).
   */
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

  /**
   * The sorted canonical model ids that price the given variant key under
   * any harness, for actionable refusal messages. Callers must not mutate.
   */
  canonicalModelsWithVariant(variant: string): string[] {
    return this.indexes.sortedModelsByVariant.get(variant) ?? [];
  }

  /**
   * The sorted canonical model ids that price the given variant key under
   * the given harness. Callers must not mutate.
   */
  canonicalModelsWithVariantForHarness(
    harness: string,
    variant: string,
  ): string[] {
    return (
      this.indexes.sortedModelsByVariantHarness.get(variant)?.get(harness) ?? []
    );
  }

  /**
   * Whether a model reference declares the given capability key (e.g.
   * "thinking") true under the given harness. Capability flags are
   * harness-scoped facts (they describe what works through that serving
   * path), so there is no any-harness form: THINKING_MODE_ENABLED validates
   * against the cursor harness specifically — the only harness with a
   * thinking translation in v1 (oss#772) — and native entries declaring the
   * same capability stay unselectable until a native wire mapping exists.
   */
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

  /**
   * The sorted canonical model ids that declare the given capability key
   * under the given harness, for actionable refusal messages.
   */
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

  /** Immediate refresh, then hourly — Go's goroutine shape (:435-447). */
  startRefresh(): void {
    if (!this.options.refreshEnabled || this.refreshTimer !== undefined) {
      return;
    }
    void this.refreshOnce();
    this.refreshTimer = setInterval(() => {
      void this.refreshOnce();
    }, MODEL_REGISTRY_REFRESH_INTERVAL_MS);
    this.refreshTimer.unref();
  }

  stopRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** Exposed for tests; production goes through startRefresh. */
  async refreshOnce(): Promise<void> {
    const url = this.options.upstreamOrigin + MODEL_REGISTRY_UPSTREAM_PATH;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(MODEL_REGISTRY_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`upstream answered ${response.status}`);
      }
      const body = await response.text();
      if (Buffer.byteLength(body) > MODEL_REGISTRY_MAX_BYTES) {
        throw new Error("upstream document exceeds the size cap");
      }
      const indexes = buildIndexes(body);
      if (indexes === undefined) {
        throw new Error(
          "upstream document failed the sanity gate (no indexable models)",
        );
      }
      // Document and indexes swap together — a reader never sees a
      // document whose indexes describe a different registry.
      this.currentDocument = body;
      this.indexes = indexes;
      this.failureLogged = false;
    } catch (error) {
      const fields = {
        url,
        error: error instanceof Error ? error.message : String(error),
      };
      if (this.failureLogged) {
        this.options.logger.debug(
          "model-registry refresh failed; serving current document",
          fields,
        );
      } else {
        this.options.logger.warn(
          "model-registry refresh failed; serving current document",
          fields,
        );
        this.failureLogged = true;
      }
    }
  }
}

/**
 * Parses a registry document and derives the valid-model indexes — the TS
 * half of Go's applyDocument (:302-412). Returns undefined when the
 * document fails the sanity gate: it must parse AND index at least one
 * model entry ($comment section dividers carry no id/harness and index
 * nothing, so a divider-only document is as unusable as an empty one).
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
