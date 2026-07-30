/**
 * Warm-pool member context.
 *
 * A pool member is a blank, pre-booted cloud sandbox (selected by the
 * STIGMER_POOL_MEMBER_ID env) that polls a control queue
 * `sandbox:{memberId}` until the control plane claims it for a session.
 * The claim arrives as the AttachSession activity, which needs two things
 * only the pool boot path knows: the member's identity/credential and a
 * handle to the runner manager (to attach the session worker).
 *
 * This module is that hand-off point — a module-level registry mirroring
 * `in-flight.ts` and the shutdown-signal registry: the boot path writes,
 * the activity reads via the exported getter with zero handle to the boot
 * closure, and every non-pool process (static, desktop manager, tests)
 * simply reads undefined, which is the activity's inert state.
 */

import {
  TOKEN_TYPE_POOL_SANDBOX,
  TOKEN_TYPE_SANDBOX,
  tokenTypeOf,
  sessionIdClaimOf,
} from "./client/token-claims.js";

/** The manager surface the attach path needs — kept minimal for testability. */
export interface PoolAttachTarget {
  addSession(sessionId: string): Promise<void>;
  updateToken(token: string | null): void;
}

export interface PoolMemberContext {
  /** The pool member id this process was provisioned as. */
  readonly memberId: string;
  /**
   * The pool_sandbox credential the member booted with. Captured at
   * registration because the manager's tokenRef is overwritten with the
   * session token during attach — the exchange itself must authenticate
   * with the pool credential.
   */
  readonly poolToken: string;
  /** The live runner manager hosting this member's workers. */
  readonly manager: PoolAttachTarget;
}

let _context: PoolMemberContext | undefined;

/** Called once by the pool boot path after the manager is up. */
export function registerPoolMemberContext(context: PoolMemberContext): void {
  _context = context;
}

/** Undefined everywhere except a booted pool member — the inert switch. */
export function getPoolMemberContext(): PoolMemberContext | undefined {
  return _context;
}

/** Test hook: pool membership is process-lifetime state in production. */
export function clearPoolMemberContext(): void {
  _context = undefined;
}

// ─── Boot decision ───────────────────────────────────────────────────────────

/**
 * What a pool-configured process should do, decided from its credential.
 *
 * The Secret-injected STIGMER_TOKEN is the single source of truth for a pool
 * member's identity across restarts: the token is read into the pod's env only
 * at container start, and the control plane rewrites the Secret to the session
 * token when the member is claimed. So a fresh member sees pool_sandbox and
 * polls its control queue, while a claimed member that restarted sees the
 * session token and must go straight to serving that session — its pool row
 * is gone and nothing will ever dispatch on the control queue again.
 */
export type PoolBootIntent =
  | { kind: "pool-control" }
  | { kind: "claimed-session"; sessionId: string }
  | { kind: "invalid"; reason: string };

export function decidePoolBoot(token: string | null | undefined): PoolBootIntent {
  const tokenType = tokenTypeOf(token);
  if (tokenType === TOKEN_TYPE_POOL_SANDBOX) {
    return { kind: "pool-control" };
  }
  if (tokenType === TOKEN_TYPE_SANDBOX) {
    const sessionId = sessionIdClaimOf(token);
    if (!sessionId) {
      return {
        kind: "invalid",
        reason: "session sandbox token carries no session_id claim",
      };
    }
    return { kind: "claimed-session", sessionId };
  }
  return {
    kind: "invalid",
    reason: `expected a pool_sandbox or sandbox token, got token_type=${tokenType ?? "none"}`,
  };
}
