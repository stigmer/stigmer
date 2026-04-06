"use client";

import { useCallback, useState } from "react";

/**
 * Subset of an OIDC Discovery document relevant for identity provider
 * creation.
 */
export interface OidcDiscoveryResult {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly userinfoEndpoint?: string;
}

/** Return value of {@link useOidcDiscovery}. */
export interface UseOidcDiscoveryReturn {
  /**
   * Fetch the OIDC Discovery document for the given issuer URL.
   *
   * Resolves with the parsed result on success, or `null` when the
   * fetch fails (CORS, network, invalid document). Error details are
   * available via the `error` property.
   */
  readonly discover: (issuerUrl: string) => Promise<OidcDiscoveryResult | null>;
  /** `true` while a discovery fetch is in flight. */
  readonly isDiscovering: boolean;
  /** Error from the last failed discovery, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that fetches an OIDC Discovery document from the
 * browser.
 *
 * Used by the "Custom OIDC" path in the identity provider creation
 * wizard. The hook exposes an imperative `discover()` function
 * (rather than an effect-based pattern) because discovery is
 * triggered by user action ("Continue"), not by render.
 *
 * CORS may block the fetch for some providers. When this happens
 * the hook returns `null` from `discover()` and populates `error`
 * so the wizard can fall back to manual configuration.
 */
export function useOidcDiscovery(): UseOidcDiscoveryReturn {
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const discover = useCallback(
    async (issuerUrl: string): Promise<OidcDiscoveryResult | null> => {
      setIsDiscovering(true);
      setError(null);

      try {
        const result = await fetchOidcDiscovery(issuerUrl);
        return result;
      } catch (err) {
        const wrapped =
          err instanceof Error ? err : new Error(String(err));
        setError(wrapped);
        return null;
      } finally {
        setIsDiscovering(false);
      }
    },
    [],
  );

  return { discover, isDiscovering, error };
}

// ---------------------------------------------------------------------------
// Internal fetch
// ---------------------------------------------------------------------------

async function fetchOidcDiscovery(
  issuerUrl: string,
): Promise<OidcDiscoveryResult> {
  const normalized = issuerUrl.replace(/\/+$/, "");
  const url = `${normalized}/.well-known/openid-configuration`;

  let response: Response;
  try {
    response = await fetch(url, { mode: "cors" });
  } catch {
    throw new Error(
      "Could not reach the issuer's discovery endpoint. " +
        "The provider may not allow browser requests (CORS). " +
        "You can enter the configuration manually instead.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Discovery endpoint returned HTTP ${response.status}. ` +
        "Verify the issuer URL is correct.",
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Discovery endpoint returned invalid JSON. " +
        "Verify the issuer URL points to a valid OIDC provider.",
    );
  }

  if (typeof data.issuer !== "string" || typeof data.jwks_uri !== "string") {
    throw new Error(
      "Discovery document is missing required fields (issuer, jwks_uri). " +
        "This may not be a compliant OpenID Connect provider.",
    );
  }

  return {
    issuer: data.issuer,
    jwksUri: data.jwks_uri,
    userinfoEndpoint:
      typeof data.userinfo_endpoint === "string"
        ? data.userinfo_endpoint
        : undefined,
  };
}
