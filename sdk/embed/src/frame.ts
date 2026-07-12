/**
 * Frame-side helpers — the half of the embed protocol that runs inside the
 * hosted chat page (`/chat/<org>/<slug>` in `client-apps/web`).
 *
 * The embedding site cannot alter this code (it is served from the Stigmer app
 * origin), so the parent origin discovered here is honest by construction.
 * Every source in the discovery ladder is browser-controlled:
 *
 * 1. `location.ancestorOrigins[0]` — the direct parent's origin (Chromium and
 *    WebKit; not implemented in Firefox).
 * 2. `document.referrer` — the parent page URL at iframe load (all browsers,
 *    but suppressible via the embedder's Referrer-Policy).
 * 3. The `hello`/`init` postMessage handshake with the loader — the browser
 *    stamps `event.origin` on the parent's reply, which no page can forge.
 *
 * When all three fail (a plain iframe with suppressed referrer and no loader),
 * the ladder resolves to {@link OPAQUE_ORIGIN} — the WHATWG serialization of
 * an opaque origin — which the platform refuses whenever the agent's
 * `allowed_origins` list is non-empty (fail closed in strict mode).
 */

import {
  parseHostMessage,
  toWire,
  type FrameToHostMessage,
} from "./protocol.js";

/**
 * Serialization of an opaque/undiscoverable origin (WHATWG HTML spec).
 * Mirrors `SharingOriginPolicy.OPAQUE_ORIGIN` on the server.
 */
export const OPAQUE_ORIGIN = "null";

/** How long to wait for the loader's `init` reply before giving up. */
const HANDSHAKE_TIMEOUT_MS = 1_500;

/**
 * Whether the page is running inside an iframe. `false` during SSR/prerender
 * (no `window`), so static export never takes the embed path.
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws in some engines — which
    // itself proves the page is framed by a foreign origin.
    return true;
  }
}

/**
 * Resolves the embedding page's origin via the discovery ladder above.
 * Only meaningful when {@link isEmbedded} is `true`. Never rejects — an
 * undiscoverable parent resolves to {@link OPAQUE_ORIGIN}.
 */
export function resolveParentOrigin(
  timeoutMs: number = HANDSHAKE_TIMEOUT_MS,
): Promise<string> {
  const ancestor = ancestorOrigin();
  if (ancestor) return Promise.resolve(ancestor);

  const referrer = referrerOrigin();
  if (referrer) return Promise.resolve(referrer);

  return handshakeOrigin(timeoutMs);
}

function ancestorOrigin(): string | null {
  const origins = window.location.ancestorOrigins;
  const direct = origins && origins.length > 0 ? origins[0] : null;
  // An opaque ancestor serializes as "null"; treat it as undiscovered so the
  // remaining rungs get a chance before the opaque fallback.
  return direct && direct !== OPAQUE_ORIGIN ? direct : null;
}

function referrerOrigin(): string | null {
  const referrer = document.referrer;
  if (!referrer) return null;
  try {
    return new URL(referrer).origin;
  } catch {
    return null;
  }
}

/**
 * Asks the loader for `init` and reads the browser-authentic `event.origin`
 * off the reply. The `hello` is posted to `"*"` because the parent origin is
 * exactly what we do not know yet — it carries no payload, so broadcasting
 * it is safe.
 */
function handshakeOrigin(timeoutMs: number): Promise<string> {
  return new Promise((resolveOrigin) => {
    let settled = false;
    const settle = (origin: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolveOrigin(origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!parseHostMessage(event.data)) return;
      settle(event.origin === "" ? OPAQUE_ORIGIN : event.origin);
    };

    const timer = setTimeout(() => settle(OPAQUE_ORIGIN), timeoutMs);
    window.addEventListener("message", onMessage);
    window.parent.postMessage(toWire({ type: "hello" }), "*");
  });
}

/**
 * Posts a lifecycle signal to the embedding page's loader.
 *
 * Targets the discovered parent origin when known; `ready`/`refused` carry no
 * payload, so the `"*"` fallback for an opaque parent leaks nothing.
 */
export function notifyParent(
  message: FrameToHostMessage,
  parentOrigin: string,
): void {
  if (!isEmbedded()) return;
  const target = parentOrigin === OPAQUE_ORIGIN ? "*" : parentOrigin;
  window.parent.postMessage(toWire(message), target);
}
