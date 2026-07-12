import { describe, expect, it } from "vitest";

import {
  EMBED_PROTOCOL_VERSION,
  EMBED_SOURCE,
  parseFrameMessage,
  parseHostMessage,
  toWire,
} from "../protocol.js";

describe("embed protocol", () => {
  it("stamps every outbound message with source and version", () => {
    expect(toWire({ type: "ready" })).toEqual({
      source: EMBED_SOURCE,
      v: EMBED_PROTOCOL_VERSION,
      type: "ready",
    });
  });

  it("round-trips every frame->host message type", () => {
    for (const type of ["hello", "ready", "refused"] as const) {
      expect(parseFrameMessage(toWire({ type }))).toEqual({ type });
    }
  });

  it("round-trips the host->frame init message", () => {
    expect(parseHostMessage(toWire({ type: "init" }))).toEqual({ type: "init" });
  });

  it("rejects foreign messages on the shared channel", () => {
    // The message channel is page-global: analytics scripts, React DevTools,
    // and other embeds all post here. Anything unstamped must parse to null.
    const foreign: unknown[] = [
      null,
      undefined,
      "string-message",
      42,
      {},
      { type: "ready" },
      { source: "other-widget", v: 1, type: "ready" },
      { source: EMBED_SOURCE, v: 999, type: "ready" },
      { source: EMBED_SOURCE, v: EMBED_PROTOCOL_VERSION, type: "unknown" },
      { source: EMBED_SOURCE, v: EMBED_PROTOCOL_VERSION },
    ];
    for (const data of foreign) {
      expect(parseFrameMessage(data)).toBeNull();
      expect(parseHostMessage(data)).toBeNull();
    }
  });

  it("does not cross-parse directions", () => {
    expect(parseFrameMessage(toWire({ type: "init" }))).toBeNull();
    expect(parseHostMessage(toWire({ type: "ready" }))).toBeNull();
  });
});
