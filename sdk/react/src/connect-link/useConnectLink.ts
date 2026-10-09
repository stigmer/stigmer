"use client";

/**
 * A Connect link, as the person it was sent to opens it.
 *
 * An integrator makes a Connect link for one of its customers
 * (`VaultCommandController.createConnectLink`): a one-time page where the
 * customer signs in at an address and the login is saved into the
 * integrator's vault for them, with no Stigmer account. The link's secret
 * is the only authority, so every call here is public
 * (`ConnectLinkController`); the hooks still need a `StigmerProvider`
 * ancestor for the transport.
 *
 * The flow is a full-page redirect, not a popup: {@link useConnectLink}'s
 * `start` keeps the secret in this tab's session storage beside the state
 * the server started the sign-in with, and sends the browser to the login
 * page; the login page returns to the console's callback page, which hands
 * the return to {@link ConnectLinkCallback} only when its `state` is that
 * one ({@link pendingConnectLinkToken}), so a popup's return in the same
 * tab is never taken for the link's. The callback finishes the sign-in and
 * sends the browser on to the integrator's return URL. An unknown, expired
 * or used link answers NOT_FOUND, which both say the same way.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { isNotFound } from "@stigmer/sdk";
import {
  ConnectLinkTokenInputSchema,
  type ConnectLinkInfo,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { useStigmer } from "../hooks.js";
import { checkedLoginPageUrl } from "../internal/loginPageUrl.js";
import { useFetch } from "../internal/useFetch.js";
import { toError } from "../internal/toError.js";

/** The session-storage key a started link's secret and state wait under for the callback page. */
export const CONNECT_LINK_PENDING_KEY = "stigmer:connect-link:pending";

/** What a person reads when a link no longer works. */
export const DEAD_CONNECT_LINK_MESSAGE =
  "This link has expired or was already used: ask the app that sent it for a new one.";

/**
 * The secret of the Connect link this tab started whose sign-in returned
 * with `state`, or `null`: the callback page's test for whether a return is
 * the link's.
 */
export function pendingConnectLinkToken(state: string | null): string | null {
  if (state === null || state === "") return null;
  try {
    const pending = JSON.parse(sessionStorage.getItem(CONNECT_LINK_PENDING_KEY) ?? "null") as unknown;
    if (typeof pending !== "object" || pending === null) return null;
    const { token, state: started } = pending as { token?: unknown; state?: unknown };
    return typeof token === "string" && token !== "" && started === state ? token : null;
  } catch {
    return null;
  }
}

/** Forgets the Connect link this tab started. */
export function clearPendingConnectLinkToken(): void {
  try {
    sessionStorage.removeItem(CONNECT_LINK_PENDING_KEY);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

/** Return value of {@link useConnectLink}. */
export interface UseConnectLinkReturn {
  /** What the link is for, or `null` while loading or when it no longer works. */
  readonly info: ConnectLinkInfo | null;
  readonly isLoading: boolean;
  /** Whether the link is unknown, expired or already used. */
  readonly isDead: boolean;
  /** Any other failure reading or starting the link, or `null`. */
  readonly error: Error | null;
  /** Starts the sign-in: keeps the secret for the callback page and sends the browser to the login page. */
  readonly start: () => Promise<void>;
  /** Whether `start` is in flight (the browser is about to leave). */
  readonly isStarting: boolean;
}

/**
 * Data and behavior hook for a Connect link's page.
 *
 * @param token - The link's secret from its URL, or `null` to skip.
 */
export function useConnectLink(token: string | null): UseConnectLinkReturn {
  const stigmer = useStigmer();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<Error | null>(null);

  const { data: info, isLoading, error: readError } = useFetch(
    token
      ? () => stigmer.vault.getConnectLink(create(ConnectLinkTokenInputSchema, { token }))
      : null,
    [token, stigmer],
    null as ConnectLinkInfo | null,
  );

  const start = useCallback(async () => {
    if (!token) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const started = await stigmer.vault.startConnectLink(create(ConnectLinkTokenInputSchema, { token }));
      const loginPage = checkedLoginPageUrl(started.authorizationUrl);
      sessionStorage.setItem(CONNECT_LINK_PENDING_KEY, JSON.stringify({ token, state: started.state }));
      window.location.assign(loginPage);
    } catch (err) {
      setStartError(toError(err));
      setIsStarting(false);
    }
  }, [stigmer, token]);

  const error = startError ?? readError;
  const isDead = error !== null && isNotFound(error);
  return {
    info,
    isLoading,
    isDead,
    error: isDead ? null : error,
    start,
    isStarting,
  };
}
