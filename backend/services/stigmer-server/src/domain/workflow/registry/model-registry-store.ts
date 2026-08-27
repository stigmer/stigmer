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
 *
 * Since O5 (20260827.02) this class is the OSS implementation of the
 * ModelCatalogProvider seam (DD-008) — consumers hold the interface; the
 * refresh lifecycle below stays composition-owned, outside the contract.
 * The document INTERPRETATION (sanity gate, indexes, the query methods)
 * lives in document-catalog.ts since the C1 seam extraction (20260827.04):
 * this class owns only the bundled/upstream lifecycle and delegates every
 * read to the current DocumentModelCatalog, swapped atomically per
 * accepted document.
 */
import type { Logger } from "../../../boot/logger.js";
import { DocumentModelCatalog } from "./document-catalog.js";
import type { ModelCatalogProvider } from "./model-catalog-provider.js";

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

export class ModelRegistryStore implements ModelCatalogProvider {
  private currentCatalog: DocumentModelCatalog;
  private refreshTimer: NodeJS.Timeout | undefined;
  private failureLogged = false;
  private readonly options: ModelRegistryStoreOptions;

  constructor(options: ModelRegistryStoreOptions) {
    // A broken bundled snapshot is a build defect, not a runtime condition:
    // fail loud at construction rather than serving an empty registry
    // (Go log.Fatal in Store()).
    const catalog = DocumentModelCatalog.tryBuild(options.bundledDocument);
    if (catalog === undefined) {
      throw new Error(
        "bundled model-registry snapshot is invalid or indexes no models",
      );
    }
    this.currentCatalog = catalog;
    this.options = options;
  }

  /** The served bytes; always complete and valid by construction. */
  document(): string {
    return this.currentCatalog.document();
  }

  /**
   * Whether a model reference (canonical id or provider api id) is
   * executable on the given harness.
   */
  isValidModel(harness: string, model: string): boolean {
    return this.currentCatalog.isValidModel(harness, model);
  }

  /** Whether the registry knows any models for a harness. */
  hasHarness(harness: string): boolean {
    return this.currentCatalog.hasHarness(harness);
  }

  /**
   * Whether the registry loaded at all — validation degrades to a no-op
   * rather than rejecting everything when it did not.
   */
  hasAnyModels(): boolean {
    return this.currentCatalog.hasAnyModels();
  }

  /**
   * Whether a model reference is executable on AT LEAST ONE harness. The
   * existence check for surfaces with no serving harness in this edition
   * (agent channels): a pin no section knows is certainly a typo, while a
   * pin valid anywhere may be right where the spec actually serves.
   */
  isValidModelOnAnyHarness(model: string): boolean {
    return this.currentCatalog.isValidModelOnAnyHarness(model);
  }

  /**
   * The sorted, deduplicated canonical model ids across every harness
   * section — the did-you-mean candidate pool for the any-harness
   * existence check. Computed per call (refusal-path only).
   */
  canonicalModelsAcrossHarnesses(): string[] {
    return this.currentCatalog.canonicalModelsAcrossHarnesses();
  }

  /**
   * The sorted canonical model ids for a harness (deterministic
   * did-you-mean suggestions — canonical ids are the documented form, so
   * suggestions never surface provider api ids). Callers must not mutate.
   */
  canonicalModels(harness: string): string[] {
    return this.currentCatalog.canonicalModels(harness);
  }

  /**
   * Whether a model reference prices the given variant key under ANY
   * harness — the registry-backed capability check for
   * ExecutionConfig.service_tier at execution create (oss#357), which is
   * deliberately harness-free (it never resolves the session).
   */
  hasPricingVariant(model: string, variant: string): boolean {
    return this.currentCatalog.hasPricingVariant(model, variant);
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
    return this.currentCatalog.hasPricingVariantForHarness(
      harness,
      model,
      variant,
    );
  }

  /**
   * The sorted canonical model ids that price the given variant key under
   * any harness, for actionable refusal messages. Callers must not mutate.
   */
  canonicalModelsWithVariant(variant: string): string[] {
    return this.currentCatalog.canonicalModelsWithVariant(variant);
  }

  /**
   * The sorted canonical model ids that price the given variant key under
   * the given harness. Callers must not mutate.
   */
  canonicalModelsWithVariantForHarness(
    harness: string,
    variant: string,
  ): string[] {
    return this.currentCatalog.canonicalModelsWithVariantForHarness(
      harness,
      variant,
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
    return this.currentCatalog.hasCapabilityForHarness(
      harness,
      model,
      capability,
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
    return this.currentCatalog.canonicalModelsWithCapabilityForHarness(
      harness,
      capability,
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
      const catalog = DocumentModelCatalog.tryBuild(body);
      if (catalog === undefined) {
        throw new Error(
          "upstream document failed the sanity gate (no indexable models)",
        );
      }
      // Document and indexes swap together — a reader never sees a
      // document whose indexes describe a different registry.
      this.currentCatalog = catalog;
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
