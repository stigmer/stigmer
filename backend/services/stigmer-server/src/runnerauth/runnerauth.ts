/**
 * Execution-scoped runner tokens — ports pkg/runnerauth/runnerauth.go
 * (oss#535), the lane that gates the ExecutionContext decrypt path.
 *
 * WHY: since oss#535 the EC read RPCs redact is_secret values for every
 * caller — the same contract the cloud edition enforces — but the runner
 * still needs the real values to serve executions. Cloud distinguishes the
 * runner by the token_type claim of its platform-minted credential; OSS
 * ships no token VERIFIERS on its identity chassis (O2, 20260827.01 — the
 * verifier chain exists but resolves every request to the trusted-local
 * identity until O3 lands the first verifiers), so this module supplies
 * the minimal equivalent: the platform exchange mints a short-lived token
 * bound to ONE execution, and the EC handler decrypts only for a token
 * whose binding matches the requested ExecutionContext.
 *
 * A LANE DISCRIMINATOR, NOT A TRUST BOUNDARY (DD-004): in the trusted-local
 * posture anyone who can reach the server can mint. What the token buys is
 * the redaction-by-default read contract converging with cloud, on top of
 * oss#405's encryption at rest. It is deliberately NOT an IdentityVerifier
 * on the chassis: presenting it must never change the caller's identity
 * (the Q6 fall-through keeps the runner's Bearer-on-every-RPC behavior
 * byte-identical), only unlock this one decrypt lane.
 *
 * Token shape (field names are wire contract — the runner's
 * token-claims.ts reads token_type by name):
 *   {"token_type":"execution_scoped","execution_id":"<id>","iat":…,"exp":…}
 *
 * Consumers arrive with their own domains: the platform exchange RPC
 * (mint) and the executioncontext resolve step (verify). This module lands
 * with the encryption sub-project because its signing key rides the shared
 * key ladder and its boot posture is a ratified cross-domain invariant
 * (fatal — see compose.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { getOrCreateNamedKey } from "../encryption/key-manager.js";
import type { KeyLoaderOptions } from "../encryption/key-manager.js";

/**
 * The token_type claim of every OSS-minted runner token — Go
 * TokenTypeExecutionScoped. Deliberately distinct from the cloud sandbox
 * vocabulary (sandbox / workflow_sandbox / connect_sandbox): borrowing
 * "sandbox" while carrying different claims would mislead anyone debugging
 * across editions. One honest type with a direct execution_id binding.
 */
export const TOKEN_TYPE_EXECUTION_SCOPED = "execution_scoped";

/** Env var for the signing key (Base64 32B) — Go EnvKeyName. */
export const RUNNER_TOKEN_KEY_ENV_VAR = "STIGMER_RUNNER_TOKEN_KEY";

/** Auto-generated key file under ~/.stigmer — Go KeyFileName. */
export const RUNNER_TOKEN_KEY_FILE_NAME = "runner-token.key";

/**
 * Default token lifetime — Go DefaultTTL (1 hour). Tokens are minted
 * immediately before each ExecutionContext read (or carried in a connect
 * workflow's dispatch payload), so the TTL only needs to cover one unit of
 * dispatched work including its Temporal retries: generous without being
 * an effectively-permanent credential in Temporal history.
 */
export const DEFAULT_TTL_SECONDS = 3600;

/**
 * Go ErrInvalidToken: ANY verification failure — forged signature, wrong
 * algorithm, expired, wrong type, empty binding — collapses to this one
 * error. Callers fail closed to redaction on it; a finer-grained reason
 * would just invite branching on it.
 */
export class InvalidTokenError extends Error {
  constructor() {
    super("invalid runner token");
    this.name = "InvalidTokenError";
  }
}

/**
 * Go ErrMintingDisabled: minting with no signing key (keyless deployments,
 * effectively test-only — fromEnv auto-generates). The exchange RPC maps
 * it to the presence-based "not minted" response the runner handles.
 */
export class MintingDisabledError extends Error {
  constructor() {
    super("runner token minting is disabled - no signing key configured");
    this.name = "MintingDisabledError";
  }
}

/**
 * The constant JWT header: HS256 is the only algorithm this module ever
 * produces or accepts — Verify refuses alg-confusion inputs by comparing
 * the ENCODED header, without parsing attacker-controlled JSON.
 */
const JWT_HEADER = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
  "base64url",
);

/** JWT payload shape — field names are wire contract. */
interface TokenClaims {
  readonly token_type: string;
  readonly execution_id: string;
  readonly iat: number;
  readonly exp: number;
}

/** A minted token with its lifetime in whole seconds (the RPC's shape). */
export interface MintedToken {
  readonly token: string;
  readonly ttlSeconds: number;
}

/**
 * Mints and verifies execution-scoped runner tokens with a single
 * HMAC-SHA256 key. Stateless and safe for concurrent use.
 */
export class RunnerAuthService {
  private readonly key: Buffer | undefined;

  private constructor(key: Buffer | undefined) {
    this.key = key;
  }

  /**
   * Go NewService: nil/empty key → disabled service (Mint fails with
   * MintingDisabledError, Verify rejects everything — fail closed: without
   * a key no token can be genuine).
   */
  static create(key: Buffer | undefined): RunnerAuthService {
    if (key === undefined || key.length === 0) {
      return new RunnerAuthService(undefined);
    }
    return new RunnerAuthService(key);
  }

  /**
   * Go NewServiceFromEnv: key via the shared ladder (env var → key file →
   * auto-generate). Errors only on unusable explicit configuration; the
   * composition root maps that to the BOOT-FATAL posture (the ratified D2
   * asymmetry: a server that cannot mint runner tokens would hand every
   * execution redaction markers instead of its secrets — the silent-junk
   * failure the oss#405 fail-loud doctrine forbids).
   */
  static fromEnv(options: KeyLoaderOptions = {}): RunnerAuthService {
    const key = getOrCreateNamedKey(
      RUNNER_TOKEN_KEY_ENV_VAR,
      RUNNER_TOKEN_KEY_FILE_NAME,
      options,
    );
    return RunnerAuthService.create(key);
  }

  /** Go IsEnabled: whether the service holds a signing key. */
  isEnabled(): boolean {
    return this.key !== undefined;
  }

  /**
   * Go Mint: a token bound to executionId, valid for ttlSeconds
   * (DEFAULT_TTL_SECONDS when <= 0).
   */
  mint(executionId: string, ttlSeconds: number = 0): MintedToken {
    if (this.key === undefined) {
      throw new MintingDisabledError();
    }
    if (executionId === "") {
      throw new Error("execution id is required to mint a runner token");
    }
    const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const claims: TokenClaims = {
      token_type: TOKEN_TYPE_EXECUTION_SCOPED,
      execution_id: executionId,
      iat: nowSeconds,
      exp: nowSeconds + ttl,
    };
    const signingInput =
      JWT_HEADER + "." + Buffer.from(JSON.stringify(claims)).toString("base64url");
    return {
      token: signingInput + "." + this.sign(signingInput),
      ttlSeconds: ttl,
    };
  }

  /**
   * Go Verify: checks signature, algorithm, expiry, and token type, and
   * returns the execution id the token is bound to. Any failure throws the
   * one InvalidTokenError — the caller's only correct reaction is to fall
   * closed to redaction.
   *
   * Check order mirrors Go: enabled → three parts → exact encoded-header
   * compare → constant-time HMAC → payload decode → claims. The expiry
   * boundary is `now >= exp` (a token in its expiring second is invalid).
   */
  verify(token: string): string {
    if (this.key === undefined) {
      throw new InvalidTokenError();
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new InvalidTokenError();
    }
    if (parts[0] !== JWT_HEADER) {
      throw new InvalidTokenError();
    }

    const signingInput = parts[0] + "." + parts[1];
    const expected = Buffer.from(this.sign(signingInput));
    const provided = Buffer.from(parts[2] as string);
    // Go's hmac.Equal returns false on length mismatch; Node's
    // timingSafeEqual THROWS on it, so the length guard comes first (the
    // signature length is not secret — no timing channel is opened).
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new InvalidTokenError();
    }

    let claims: TokenClaims;
    try {
      claims = JSON.parse(
        Buffer.from(parts[1] as string, "base64url").toString("utf8"),
      ) as TokenClaims;
    } catch {
      throw new InvalidTokenError();
    }

    if (
      claims.token_type !== TOKEN_TYPE_EXECUTION_SCOPED ||
      typeof claims.execution_id !== "string" ||
      claims.execution_id === "" ||
      typeof claims.exp !== "number" ||
      Math.floor(Date.now() / 1000) >= claims.exp
    ) {
      throw new InvalidTokenError();
    }

    return claims.execution_id;
  }

  /** base64url HMAC-SHA256 of the signing input — Go sign(). */
  private sign(signingInput: string): string {
    if (this.key === undefined) {
      throw new InvalidTokenError();
    }
    return createHmac("sha256", this.key)
      .update(signingInput)
      .digest("base64url");
  }
}
