import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { createClient, type Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { MintGuestTokenRequestSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { wrapError } from "./gen/errors.js";
import {
  rpcMetadataInterceptor,
  errorStripInterceptor,
} from "./internal/interceptors.js";

/**
 * Minimal persistence contract for the visitor's guest id.
 *
 * Matches the subset of the Web Storage API that {@link GuestAuth}
 * needs, so `localStorage` satisfies it directly. Inject a custom
 * implementation for non-browser environments or tests.
 */
export interface GuestIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Configuration for a guest token-minting helper.
 *
 * Unlike {@link PlatformClientAuthConfig}, this carries **no
 * credentials** — `mintGuestToken` is a public RPC gated server-side
 * on the agent's `spec.sharing.enabled`. It is therefore safe to use
 * directly from a browser.
 *
 * @example
 * ```typescript
 * import { createGuestAuth } from "@stigmer/sdk";
 *
 * const guestAuth = createGuestAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   org: "acme",
 *   slug: "support-agent",
 * });
 * ```
 */
export interface GuestAuthConfig {
  /** Stigmer API server URL (e.g., "https://api.stigmer.ai"). */
  readonly baseUrl: string;

  /** Organization slug from the share URL. */
  readonly org: string;

  /** Agent slug from the share URL. */
  readonly slug: string;

  /**
   * Where to persist the visitor's guest id across visits.
   *
   * Defaults to `localStorage` when available, falling back to
   * in-memory storage (guest identity then lasts one page load).
   * The stored value is an opaque server-generated id — not a
   * credential — that keys this browser's session read-isolation.
   */
  readonly storage?: GuestIdStorage;
}

/**
 * How long before expiry a cached guest token is considered stale.
 * Re-minting inside this window keeps long-lived streams from starting
 * with a token that expires moments later.
 */
const EXPIRY_SKEW_MS = 60_000;

/** Storage key prefix for the persisted guest id, namespaced per org. */
const GUEST_ID_STORAGE_PREFIX = "stigmer:guest-id:";

/**
 * Guest token-minting helper for shared-agent pages.
 *
 * A minimal, purpose-built companion to the main Stigmer client: it
 * lazily mints short-lived guest JWTs via the public `mintGuestToken`
 * RPC, caches them in memory until just before expiry, and persists
 * the server-issued guest id so the same browser resolves to the same
 * guest across visits.
 *
 * Wire {@link getAccessToken} into a `Stigmer` client — the SDK calls
 * it per request, so refresh is automatic and no token ever needs to
 * be stored outside memory.
 *
 * Failure semantics: when minting fails (e.g. sharing was revoked —
 * the server answers NOT_FOUND, indistinguishable from "no such
 * agent"), {@link getAccessToken} rejects with a `StigmerError`, which
 * fails the triggering request with the real cause instead of sending
 * it unauthenticated.
 *
 * @example
 * ```typescript
 * const guestAuth = createGuestAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   org: "acme",
 *   slug: "support-agent",
 * });
 *
 * const client = new Stigmer({
 *   baseUrl: "https://api.stigmer.ai",
 *   getAccessToken: guestAuth.getAccessToken,
 * });
 * ```
 */
export class GuestAuth {
  private readonly tokenClient: Client<typeof PlatformClientTokenController>;
  private readonly org: string;
  private readonly slug: string;
  private readonly storage: GuestIdStorage;
  private readonly storageKey: string;

  private cached: { accessToken: string; expiresAt: number } | null = null;
  private pendingMint: Promise<string> | null = null;

  /** @internal Use {@link createGuestAuth} instead. */
  constructor(config: GuestAuthConfig) {
    this.org = config.org;
    this.slug = config.slug;
    this.storage = config.storage ?? resolveDefaultStorage();
    this.storageKey = `${GUEST_ID_STORAGE_PREFIX}${config.org}`;

    const transport = createGrpcWebTransport({
      baseUrl: config.baseUrl,
      interceptors: [rpcMetadataInterceptor, errorStripInterceptor],
    });

    this.tokenClient = createClient(PlatformClientTokenController, transport);
  }

  /**
   * The visitor's persisted guest id, or `null` before the first
   * successful mint in this browser.
   */
  get guestCookieId(): string | null {
    return safeGetItem(this.storage, this.storageKey);
  }

  /**
   * Token provider for `StigmerConfig.getAccessToken`.
   *
   * Returns the cached guest JWT while it has more than a minute of
   * life left; otherwise mints a fresh one. Concurrent callers during
   * a mint share the same in-flight request (single-flight).
   *
   * Defined as an arrow property so it can be passed detached:
   * `new Stigmer({ ..., getAccessToken: guestAuth.getAccessToken })`.
   *
   * @throws {StigmerError} with code `"not-found"` when the agent is
   *   not shared (or sharing was revoked — the server keeps the two
   *   indistinguishable by design)
   * @throws {StigmerError} with code `"invalid-argument"` when org or
   *   slug is malformed
   */
  readonly getAccessToken = async (): Promise<string | null> => {
    if (this.cached && this.cached.expiresAt - Date.now() > EXPIRY_SKEW_MS) {
      return this.cached.accessToken;
    }

    // Single-flight: the provider is invoked once per request, so a
    // burst at page load (registry fetches + profile resolution) must
    // collapse into one mint — both for latency and because concurrent
    // first mints would otherwise race to persist different guest ids.
    this.pendingMint ??= this.mint().finally(() => {
      this.pendingMint = null;
    });

    return this.pendingMint;
  };

  private async mint(): Promise<string> {
    try {
      const response = await this.tokenClient.mintGuestToken(
        create(MintGuestTokenRequestSchema, {
          org: this.org,
          slug: this.slug,
          guestCookieId: safeGetItem(this.storage, this.storageKey) ?? "",
        }),
      );

      safeSetItem(this.storage, this.storageKey, response.guestCookieId);
      this.cached = {
        accessToken: response.accessToken,
        expiresAt: Date.now() + response.expiresIn * 1000,
      };
      return response.accessToken;
    } catch (e) {
      throw wrapError(e);
    }
  }
}

/**
 * `localStorage` when usable, otherwise an in-memory fallback.
 *
 * Access is probed inside try/catch because merely touching
 * `localStorage` can throw (e.g. sandboxed iframes with storage
 * blocked). With the fallback, the chat still works — the visitor
 * just gets a fresh guest identity per page load.
 *
 * `globalThis` is typed structurally because this package compiles
 * without DOM libs (it is also consumed from Node, where
 * `localStorage` does not exist).
 */
function resolveDefaultStorage(): GuestIdStorage {
  try {
    const { localStorage: storage } = globalThis as {
      localStorage?: GuestIdStorage & { removeItem(key: string): void };
    };
    if (storage) {
      const probeKey = "stigmer:storage-probe";
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
      return storage;
    }
  } catch {
    // Fall through to the in-memory storage below.
  }

  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
  };
}

/**
 * Storage reads/writes never fail the mint: the guest id is a
 * convenience (stable identity across visits), not a requirement —
 * the server issues a fresh id when none is presented.
 */
function safeGetItem(storage: GuestIdStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(storage: GuestIdStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Persisting the id is best-effort; see safeGetItem.
  }
}

/**
 * Create a guest token-minting helper for a shared agent's hosted page
 * or embed.
 *
 * This is the browser-side counterpart of `createPlatformClientAuth`:
 * it involves **no credentials** — the server gates minting on the
 * agent's `spec.sharing.enabled` and issues a short-lived guest JWT
 * scoped to the sharing org. Pass {@link GuestAuth.getAccessToken} to
 * a `Stigmer` client and every request authenticates as this visitor.
 *
 * @example
 * ```typescript
 * import { Stigmer, createGuestAuth } from "@stigmer/sdk";
 *
 * const guestAuth = createGuestAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   org: "acme",
 *   slug: "support-agent",
 * });
 *
 * const client = new Stigmer({
 *   baseUrl: "https://api.stigmer.ai",
 *   getAccessToken: guestAuth.getAccessToken,
 * });
 * ```
 *
 * @throws {Error} if `baseUrl`, `org`, or `slug` is missing or empty
 */
export function createGuestAuth(config: GuestAuthConfig): GuestAuth {
  if (!config.baseUrl) {
    throw new Error(
      "createGuestAuth: baseUrl is required (e.g., \"https://api.stigmer.ai\")",
    );
  }
  if (!config.org) {
    throw new Error(
      "createGuestAuth: org is required — the organization slug from the share URL",
    );
  }
  if (!config.slug) {
    throw new Error(
      "createGuestAuth: slug is required — the agent slug from the share URL",
    );
  }

  return new GuestAuth(config);
}
