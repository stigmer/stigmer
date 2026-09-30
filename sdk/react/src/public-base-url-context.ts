"use client";

import { createContext, useContext } from "react";
import { useStigmer } from "./hooks.js";
import { trimTrailing } from "./internal/trim.js";

/**
 * React context for the server's public base URL: the address the Stigmer
 * API is reached at from outside the page, supplied by the host through
 * `StigmerProvider`'s `publicBaseUrl`.
 *
 * Separated from the provider to mirror the `ExecutionTargetContext`
 * pattern and avoid circular imports.
 *
 * `undefined` means the host named no public address; the client's own
 * `baseUrl` then stands in when it is absolute.
 */
export const PublicBaseUrlContext = createContext<string | undefined>(
  undefined,
);

/**
 * The server's public base URL for URLs the SDK shows a user to copy (a
 * webhook URL pasted into Slack or Meta, a platform client snippet run by
 * a backend), or `null` when it cannot be known.
 *
 * The host owns public addresses, and the SDK never guesses one (the
 * `buildShareUrl` precedent in `ShareAgentDialog`): the provider's
 * `publicBaseUrl` wins, the client's `baseUrl` stands in for it, and only
 * an absolute `http(s)` URL counts. A relative `baseUrl` (a same-origin
 * proxy, the documentation tours) with no `publicBaseUrl` answers `null`,
 * because the page's own origin need not be where the API is reached from
 * outside; the surface then says the address is unknown instead of offering
 * one nobody can call. A `publicBaseUrl` that is not absolute is a host
 * mistake and counts for nothing. Trailing slashes are trimmed.
 */
export function usePublicBaseUrl(): string | null {
  const hostPublicBaseUrl = useContext(PublicBaseUrlContext);
  const { baseUrl } = useStigmer();
  return resolvePublicBaseUrl(hostPublicBaseUrl, baseUrl);
}

/**
 * The pure rule behind {@link usePublicBaseUrl}: the first of the host's
 * public base URL and the client's base URL that is an absolute `http(s)` URL,
 * trailing slashes trimmed, or `null` when neither is.
 */
export function resolvePublicBaseUrl(
  hostPublicBaseUrl: string | undefined,
  clientBaseUrl: string,
): string | null {
  for (const candidate of [hostPublicBaseUrl, clientBaseUrl]) {
    if (candidate !== undefined && isAbsoluteUrl(candidate)) {
      return trimTrailing(candidate, "/");
    }
  }
  return null;
}

/**
 * Whether `value` is an absolute `http(s)` URL. The protocol check matters:
 * `new URL("localhost:7234")` parses, with `localhost:` as its scheme.
 */
function isAbsoluteUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
