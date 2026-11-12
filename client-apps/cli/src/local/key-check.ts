// Whether Anthropic takes a key, asked of Anthropic itself before the CLI
// calls the key ready: `stigmer up` and `stigmer setup` check the key the
// local runner will send, so a wrong key is said at the moment it is entered,
// not inside a first run (stigmer#3036).
//
// The rule is Stigmer Cloud's key check, outcome for outcome, so every edition
// gives a key the same three answers: `GET <base>/v1/models` with the key,
// 401 or 403 is rejected, a 2xx accepted, and anything else (another status, a
// timeout, a network fault, a proxy in the way) unchecked, which keeps the key
// and says so. A listing reads no billing and spends nothing, so a key with no
// credit passes; the run's own failure names that. The base is the one the
// runner sends the key to (ANTHROPIC_BASE_URL, else Anthropic's own API, the
// runner's endpoint rule in backend/services/runner/src/agent-proxy/lanes.ts),
// so a gateway's key is checked against the gateway. A redirect is never
// followed (a 3xx is unchecked), so the key reaches only the host the runner
// was given. The response body is never read and the key is never logged.

/** What Anthropic said about a key: took it, refused it, or did not answer. */
export type KeyCheck = "accepted" | "rejected" | "unchecked";

/** Anthropic's own API, where the runner sends a key when no base URL is set. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/** The API version the check asks for; the listing has been stable under it. */
const ANTHROPIC_VERSION = "2023-06-01";

/** How long the check waits before it calls the key unchecked. */
export const KEY_CHECK_TIMEOUT_MS = 10_000;

/** The fetch the check dials with; tests pass their own. */
export type KeyCheckFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" },
) => Promise<{
  readonly status: number;
}>;

/**
 * Ask Anthropic (or the gateway at `baseUrl`) whether it takes `key`. Never
 * throws: a fault of any kind is `unchecked`.
 */
export async function checkAnthropicKey(
  key: string,
  baseUrl: string = "",
  fetchImpl: KeyCheckFetch = fetch,
  timeoutMs: number = KEY_CHECK_TIMEOUT_MS,
): Promise<KeyCheck> {
  const base = (baseUrl.trim() === "" ? ANTHROPIC_API_URL : baseUrl.trim()).replace(/\/+$/, "");
  try {
    const response = await fetchImpl(`${base}/v1/models`, {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (response.status === 401 || response.status === 403) return "rejected";
    if (response.status >= 200 && response.status < 300) return "accepted";
    return "unchecked";
  } catch {
    return "unchecked";
  }
}
