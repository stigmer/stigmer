/**
 * The first-sign-in flow, once: make sure the authenticated caller has an
 * identity account, creating it if this is the first time they arrive.
 *
 * Every edition serves `IdentityAccount` from one controller (20260911.11),
 * and every surface that greets a signed-in person runs the same two-step
 * flow — the console's `useIdentityAccountGate` (`@stigmer/react`), the
 * CLI's `auth login` and `auth whoami`, and any platform builder's own
 * gate. This module is that flow's one home, so the surfaces cannot drift
 * on the question "what does a missing account mean?".
 *
 * Three facts it is built on:
 *
 * - `whoAmI` answers NOT_FOUND for an authenticated caller who has no
 *   account yet (the server's byte-pinned copy: "Identity account not found
 *   for the authenticated user"). That code, and ONLY that code, means
 *   "provision me". UNAUTHENTICATED, UNAVAILABLE, a transport fault — each
 *   is the caller's to handle and is rethrown as the same object.
 * - `provisionMyAccount` is the one creator of a direct account and is
 *   idempotent by the caller's subject: two racing first sign-ins resolve
 *   to one row. Its failures are also rethrown untouched (the issuer's
 *   userinfo being down is UNAVAILABLE, the documented arm).
 * - Whether THIS call created the account is part of the answer. A first
 *   sign-in should be visible ("your account was created"), not silent.
 *
 * The client parameter is structural, the `McpServerConnectLane` precedent:
 * the full `Stigmer` client satisfies it, and a test can hand in two
 * functions.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { isNotFound } from "./errors.js";

/**
 * The slice of the identity-account client this flow needs. Errors are the
 * SDK client's `StigmerError`s; `isNotFound` is the one classifier read.
 */
export interface IdentityAccountLane {
  whoAmI(): Promise<IdentityAccount>;
  provisionMyAccount(): Promise<IdentityAccount>;
}

/** Options for {@link ensureMyIdentityAccount}. */
export interface EnsureMyIdentityAccountOptions {
  /**
   * Called once, before `provisionMyAccount` is issued, when `whoAmI` found
   * no account — the moment a surface shows "Setting up your account…".
   * Not called when the account already exists.
   */
  readonly onProvisioning?: () => void;
}

/** What {@link ensureMyIdentityAccount} learned. */
export interface EnsuredIdentityAccount {
  /** The caller's account, existing or just created. */
  readonly account: IdentityAccount;
  /** `true` when this call created the account (a first sign-in). */
  readonly created: boolean;
}

/**
 * Resolve the caller's identity account, provisioning it on a first sign-in.
 *
 * `whoAmI` first; on NOT_FOUND — and only NOT_FOUND — `onProvisioning` fires
 * and `provisionMyAccount` runs. Every other error, from either RPC, is
 * rethrown as the same object so the caller's error UX owns it.
 *
 * @example
 * ```ts
 * const { account, created } = await ensureMyIdentityAccount(stigmer, {
 *   onProvisioning: () => console.log("Setting up your account…"),
 * });
 * ```
 */
export async function ensureMyIdentityAccount(
  client: { readonly identityAccount: IdentityAccountLane },
  options?: EnsureMyIdentityAccountOptions,
): Promise<EnsuredIdentityAccount> {
  try {
    const account = await client.identityAccount.whoAmI();
    return { account, created: false };
  } catch (err: unknown) {
    if (!isNotFound(err)) throw err;
  }
  options?.onProvisioning?.();
  const account = await client.identityAccount.provisionMyAccount();
  return { account, created: true };
}
