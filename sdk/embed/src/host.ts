/**
 * Host-side embed controller — the loader half of the protocol, shared by the
 * `<stigmer-agent>` element (and any future framework adapters) so the
 * message-pinning rules live in exactly one place.
 */

import { parseFrameMessage, toWire } from "./protocol.js";

export interface EmbedHostHandlers {
  /** The widget rendered inside the iframe and may be shown. */
  readonly onReady?: () => void;
  /** The platform refused this embed context; the caller should hide the widget. */
  readonly onRefused?: () => void;
}

export interface EmbedHost {
  /** Detaches listeners. Call when the iframe is removed. */
  destroy(): void;
}

/**
 * Wires the host side of the embed bridge onto an iframe.
 *
 * Security posture: every inbound message is pinned to both the iframe's
 * `contentWindow` (source) and the expected frame origin, and `init` is only
 * ever posted to that origin. `init` is sent once the iframe loads and again
 * on every `hello` — the frame's script may attach its listener after the
 * load-time send, so the handshake must be answerable at any time.
 */
export function createEmbedHost(
  iframe: HTMLIFrameElement,
  frameOrigin: string,
  handlers: EmbedHostHandlers = {},
): EmbedHost {
  const sendInit = (): void => {
    iframe.contentWindow?.postMessage(toWire({ type: "init" }), frameOrigin);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== frameOrigin) return;
    const message = parseFrameMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "hello":
        sendInit();
        break;
      case "ready":
        handlers.onReady?.();
        break;
      case "refused":
        handlers.onRefused?.();
        break;
    }
  };

  window.addEventListener("message", onMessage);
  iframe.addEventListener("load", sendInit);

  return {
    destroy(): void {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", sendInit);
    },
  };
}
