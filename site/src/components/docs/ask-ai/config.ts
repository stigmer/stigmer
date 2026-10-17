/**
 * Ask AI wiring constants.
 *
 * `CHANNEL` is the id of the public web channel (the chat link) applied from
 * `docs-agent/channels/stigmer-docs.yaml`, and `APP_ORIGIN` the Stigmer app
 * that hosts its chat page. A hosted chat link names its channel only by its
 * id, which the server mints when the channel is first applied, so the id is
 * read back from the deployment and set here (`docs-agent/README.md` has the
 * steps). Empty means no chat link is wired: the Ask AI button and panel
 * render nothing. Hardcoded absolutes: the docs site is a single-origin
 * static export with no environment plumbing,
 * and a relative or env-derived value would only add a way to be wrong.
 */

export const ASK_AI_CHANNEL = "";
export const ASK_AI_APP_ORIGIN = "https://app.stigmer.ai";

/**
 * How long to wait for the embed's `stigmer:ready` / `stigmer:refused`
 * signal before declaring the chat unavailable. `ready` fires on the guest
 * token mint (fast), not on the agent's first answer (slow) — so this only
 * trips when the hosted app is unreachable and the iframe would otherwise
 * sit blank forever.
 */
export const ASK_AI_READY_TIMEOUT_MS = 15_000;
