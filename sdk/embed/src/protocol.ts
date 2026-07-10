/**
 * The postMessage wire contract between the embed loader (host page) and the
 * hosted chat page (inside the iframe).
 *
 * This module is the single source of truth for the protocol: the loader
 * (`element.ts` / `host.ts`) and the chat page (`frame.ts`, consumed by
 * `client-apps/web`) both import these constants and parsers — nothing is
 * redeclared elsewhere. Every message is stamped with {@link EMBED_SOURCE}
 * and {@link EMBED_PROTOCOL_VERSION}; receivers must ignore anything that
 * does not match, because the browser `message` channel is shared with the
 * whole page.
 *
 * v1 messages:
 * - host -> frame `init` — carries no payload; its value is the browser-set
 *   `event.origin`, which tells the framed page who embeds it (unforgeable).
 * - frame -> host `hello` — asks the host to (re)send `init`, for the case
 *   where the frame's listener attaches after the host's load-time `init`.
 * - frame -> host `ready` — the widget rendered and may be shown.
 * - frame -> host `refused` — the platform refused this embed context (origin
 *   not allowed); the loader hides the element gracefully.
 */

export const EMBED_SOURCE = "stigmer-embed";
export const EMBED_PROTOCOL_VERSION = 1;

/** Messages sent by the hosted chat page (frame) to the embedding page (host). */
export type FrameToHostMessage =
  | { readonly type: "hello" }
  | { readonly type: "ready" }
  | { readonly type: "refused" };

/** Messages sent by the embedding page (host) to the hosted chat page (frame). */
export type HostToFrameMessage = { readonly type: "init" };

interface Envelope {
  readonly source: typeof EMBED_SOURCE;
  readonly v: typeof EMBED_PROTOCOL_VERSION;
  readonly type: string;
}

/** Wraps a message in the versioned envelope for `postMessage`. */
export function toWire(
  message: FrameToHostMessage | HostToFrameMessage,
): Envelope {
  return { source: EMBED_SOURCE, v: EMBED_PROTOCOL_VERSION, ...message };
}

function parseEnvelope(data: unknown): Envelope | null {
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.source !== EMBED_SOURCE) return null;
  if (candidate.v !== EMBED_PROTOCOL_VERSION) return null;
  if (typeof candidate.type !== "string") return null;
  return candidate as unknown as Envelope;
}

/** Parses an inbound message on the host side; `null` for foreign messages. */
export function parseFrameMessage(data: unknown): FrameToHostMessage | null {
  const envelope = parseEnvelope(data);
  if (!envelope) return null;
  switch (envelope.type) {
    case "hello":
    case "ready":
    case "refused":
      return { type: envelope.type };
    default:
      return null;
  }
}

/** Parses an inbound message on the frame side; `null` for foreign messages. */
export function parseHostMessage(data: unknown): HostToFrameMessage | null {
  const envelope = parseEnvelope(data);
  if (!envelope) return null;
  return envelope.type === "init" ? { type: "init" } : null;
}
