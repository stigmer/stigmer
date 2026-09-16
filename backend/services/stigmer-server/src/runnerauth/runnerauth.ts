/**
 * Execution-scoped runner tokens — ports pkg/runnerauth/runnerauth.go
 * (oss#535): one HS256 token type, bound to ONE execution, serving two
 * lanes that the server's posture decides between.
 *
 * WHY: since oss#535 the EC read RPCs redact is_secret values for every
 * caller — the same contract the cloud edition enforces — but the runner
 * still needs the real values to serve executions. Cloud distinguishes the
 * runner by the token_type claim of its platform-minted credential; this
 * module is the open-source equivalent: a token whose binding names the
 * execution it serves, and the EC handler decrypts only for a token whose
 * binding matches the requested ExecutionContext.
 *
 * THE TWO LANES, BY POSTURE. Until 2026-09-16 this header stated the
 * token was "deliberately NOT an IdentityVerifier on the chassis:
 * presenting it must never change the caller's identity". That sentence
 * described a server that did not enforce authorization: with the
 * permissive Authorizer, the runner's operator key could do everything,
 * so the token only needed to unlock one decrypt lane. Under the built-in
 * authorization posture (an OIDC self-host; authorization/posture.ts) the
 * server enforces the cloud's model, and a runner keyed with one
 * operator's API key could report on nobody's run but the operator's.
 * So under that posture the SAME token is also an identity
 * (runner-subject-verifier.ts): it admits its bearer as the human whose
 * run it is, the person the execution row's creator stamp names, for as
 * long as that run lives. The runner acts as the run's human, which is
 * what the cloud's managed sandbox has always done. Under trusted-local
 * no verifier is composed and the token stays the decrypt-lane
 * discriminator it was: anyone who can reach that server can mint one,
 * and there is one person to be.
 *
 * Token shape (field names are wire contract — the runner's
 * token-claims.ts reads token_type by name):
 *   {"token_type":"execution_scoped","execution_id":"<id>","iat":…,"exp":…}
 *
 * Two mints, one shape:
 *   - `mint(executionId, ttl)` — the CLOCKED token: the trusted-local
 *     exchange and the connect and sandbox lanes, whose one unit of work
 *     has a bounded lifetime. `exp` is present and enforced.
 *   - `mintRunCredential(executionId)` — the RUN credential: the two
 *     execution engines put it on every dispatch's workflow input
 *     (dispatch-credential.ts), and under the built-in posture the
 *     exchange mints it too, for the run's own person only
 *     (built-in-runner-credential-provider.ts). NO `exp`. A run waits on
 *     humans with no timeout and outlives any clock; its credential's
 *     validity is the ROW's — the execution is live, or ended within a
 *     short grace (bound-execution.ts) — read by both lanes that accept
 *     the token, because a plaintext token in Temporal history must not
 *     decrypt a finished run's secrets, and the clock that prevented that
 *     is gone.
 * `verify` enforces `exp` when present and accepts its absence; it never
 * decides liveness, which needs the store.
 *
 * Consumers arrive with their own domains, through the provider seam
 * (runner-credential-provider.ts): the platform exchange RPC and the two
 * engine clients (mint), the executioncontext resolve step and the
 * runner-subject verifier (verify). This module lands with the
 * encryption sub-project because its signing key rides the shared key
 * ladder and its boot posture is a ratified cross-domain invariant
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

/**
 * JWT payload shape — field names are wire contract. `exp` is absent on
 * the run credential (its validity is the row's) and present on every
 * clocked token.
 */
interface TokenClaims {
  readonly token_type: string;
  readonly execution_id: string;
  readonly iat: number;
  readonly exp?: number;
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
   * composition root maps that to the BOOT-FATAL posture: a server that
   * cannot mint runner tokens would hand every execution redaction markers
   * instead of its secrets — the silent-junk failure the encryption work
   * (stigmer#405) made fail-loud.
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
    const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      token: this.signClaims(executionId, {
        iat: nowSeconds,
        exp: nowSeconds + ttl,
      }),
      ttlSeconds: ttl,
    };
  }

  /**
   * The run credential: bound to `executionId`, with NO `exp` (see the
   * header — a run outlives any clock; the row decides). The dispatch
   * path mints it into the workflow input; only the string travels, since
   * there is no lifetime to report.
   */
  mintRunCredential(executionId: string): string {
    return this.signClaims(executionId, {
      iat: Math.floor(Date.now() / 1000),
    });
  }

  private signClaims(
    executionId: string,
    clock: Pick<TokenClaims, "iat" | "exp">,
  ): string {
    if (this.key === undefined) {
      throw new MintingDisabledError();
    }
    if (executionId === "") {
      throw new Error("execution id is required to mint a runner token");
    }
    const claims: TokenClaims = {
      token_type: TOKEN_TYPE_EXECUTION_SCOPED,
      execution_id: executionId,
      ...clock,
    };
    const signingInput =
      JWT_HEADER +
      "." +
      Buffer.from(JSON.stringify(claims)).toString("base64url");
    return signingInput + "." + this.sign(signingInput);
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
   * A token with no `exp` is a run credential and passes this check; a
   * present `exp` that is not a number is a malformed clock and refuses.
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
      claims.execution_id === ""
    ) {
      throw new InvalidTokenError();
    }
    if (
      claims.exp !== undefined &&
      (typeof claims.exp !== "number" ||
        Math.floor(Date.now() / 1000) >= claims.exp)
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

/**
 * The `token_type` claim read off an UNVERIFIED token, or undefined for
 * anything that is not a three-segment token with a JSON payload naming
 * one. This is the runner-subject verifier's claim rule (the chassis
 * contract: decide "is this ours?" before trusting anything), so it must
 * never throw and must trust nothing it reads — `verify` runs afterwards
 * on a claimed token. It is NOT a shortcut for reading claims a caller
 * intends to act on.
 */
export function peekTokenType(token: string): string | undefined {
  const claims = decodePayload(token);
  const type = claims?.["token_type"];
  return typeof type === "string" && type !== "" ? type : undefined;
}

/**
 * Whether a token this module has ALREADY verified carries a clock. The
 * decrypt lane reads it to know which validity rule applies (a clocked
 * token's clock was enforced by `verify`; a run credential's validity is
 * the row's). Reading the payload of a verified token is a read of
 * trusted state, the GuardMemoryCapture precedent; on anything `verify`
 * has not accepted the answer is meaningless, so callers verify first.
 */
export function isClockedToken(verifiedToken: string): boolean {
  return typeof decodePayload(verifiedToken)?.["exp"] === "number";
}

function decodePayload(token: string): Record<string, unknown> | undefined {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return undefined;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8"),
    );
    return typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
