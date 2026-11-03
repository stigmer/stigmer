/**
 * What the server the app points at says, before anyone signs in.
 *
 * The app's first step on any server is `getServerInfo`, which needs no
 * credential. Its answer decides everything after it:
 *   - the server trusts every request: the app opens, with no sign-in;
 *   - the server signs people in and announces a native client
 *     (`nativeSignIn`): the sign-in screen, through that provider;
 *   - the server signs people in but announces none, or predates the
 *     field: the app says the server is not set up for it, and how;
 *   - no answer: the app could not reach the server, or something answered
 *     that is not a Stigmer server, and says which.
 * Nothing is guessed from the address. These are pure functions, so every
 * outcome is tested without a server.
 */

import type { NativeSignIn, ServerInfo } from "@stigmer/client";

/** What the app does once the server has answered. */
export type ConnectOutcome =
  | { readonly kind: "open" }
  | { readonly kind: "sign-in"; readonly nativeSignIn: NativeSignIn }
  | { readonly kind: "not-set-up" };

/** Why the server gave no answer. */
export type ConnectFailure = "unreachable" | "not-stigmer";

/** The outcome a server's answer makes. */
export function connectOutcome(info: Pick<ServerInfo, "authenticationRequired" | "nativeSignIn">): ConnectOutcome {
  if (info.authenticationRequired === false) return { kind: "open" };
  if (info.authenticationRequired === true && info.nativeSignIn !== undefined) {
    return { kind: "sign-in", nativeSignIn: info.nativeSignIn };
  }
  return { kind: "not-set-up" };
}

/**
 * How the app names a server on screen: "Stigmer Cloud" when the server
 * says it is the cloud edition, otherwise its host as the person typed it.
 */
export function serverLabel(info: Pick<ServerInfo, "deploymentMode"> | undefined, origin: string): string {
  if (info?.deploymentMode === "cloud") return "Stigmer Cloud";
  return hostOf(origin);
}

/** The host (and port) of an origin, as a person reads it. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

interface WithCause {
  readonly cause?: unknown;
  readonly code?: unknown;
}

/**
 * Why `getServerInfo` failed. A request that never got an answer (the
 * connection refused, the name unknown, TLS refused) reaches the client as
 * an error whose cause is the transport's own failure; so does a proxy
 * that answers for an upstream it cannot reach (`unavailable`). An answer
 * that is not a Stigmer server's (a web page, a 404) arrives with no such
 * cause.
 */
export function connectFailureOf(error: unknown): ConnectFailure {
  const outer = error as WithCause | undefined;
  if (outer?.code === "unavailable") return "unreachable";
  const connectError = outer?.cause as WithCause | undefined;
  const transportFailure = connectError?.cause;
  if (transportFailure !== undefined && !isConnectError(transportFailure)) return "unreachable";
  return "not-stigmer";
}

function isConnectError(value: unknown): boolean {
  return value instanceof Error && value.name === "ConnectError";
}
