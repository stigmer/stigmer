/**
 * Model-registry document store — ports the Go server's ModelRegistryStore
 * (pkg/domain/workflow/registry/model_registry_store.go).
 *
 * The store always holds a complete, valid document: it starts from the
 * bundled build-time snapshot (offline-install contract — a server with no
 * outbound network still answers a full registry) and upgrades in place
 * from the hosted API. Every transition is guarded by the same sanity gate
 * Go applies (applyDocument, :299-306): the candidate must parse and carry
 * at least one model, otherwise it is rejected and the current document
 * stays — a bad upstream can never blank the console's model pickers.
 *
 * Failure logging matches Go (:454-476): the FIRST consecutive refresh
 * failure logs at warn, repeats at debug until a success resets the flag —
 * an offline laptop must not fill its log with hourly warnings.
 */
import type { Logger } from "../../boot/logger.js";

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

export interface ModelRegistryStoreOptions {
  /** Bundled build-time snapshot; MUST pass the sanity gate at boot. */
  bundledDocument: string;
  upstreamOrigin: string;
  refreshEnabled: boolean;
  logger: Logger;
  /** Test seam for the upstream fetch. */
  fetchImpl?: typeof fetch;
}

export class ModelRegistryStore {
  private currentDocument: string;
  private refreshTimer: NodeJS.Timeout | undefined;
  private failureLogged = false;
  private readonly options: ModelRegistryStoreOptions;

  constructor(options: ModelRegistryStoreOptions) {
    // A broken bundled snapshot is a build defect, not a runtime condition:
    // fail loud at construction rather than serving an empty registry.
    if (!passesSanityGate(options.bundledDocument)) {
      throw new Error("bundled model-registry snapshot is invalid or carries no models");
    }
    this.currentDocument = options.bundledDocument;
    this.options = options;
  }

  /** The served bytes; always complete and valid by construction. */
  document(): string {
    return this.currentDocument;
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
      if (!passesSanityGate(body)) {
        throw new Error("upstream document failed the sanity gate (no models)");
      }
      this.currentDocument = body;
      this.failureLogged = false;
    } catch (error) {
      const fields = { url, error: error instanceof Error ? error.message : String(error) };
      if (this.failureLogged) {
        this.options.logger.debug("model-registry refresh failed; serving current document", fields);
      } else {
        this.options.logger.warn("model-registry refresh failed; serving current document", fields);
        this.failureLogged = true;
      }
    }
  }
}

function passesSanityGate(document: string): boolean {
  try {
    const parsed = JSON.parse(document) as { models?: unknown };
    return Array.isArray(parsed.models) && parsed.models.length > 0;
  } catch {
    return false;
  }
}
