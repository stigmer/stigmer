import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmbedHost } from "../host.js";
import { toWire } from "../protocol.js";

const FRAME_ORIGIN = "https://app.stigmer.example";

/**
 * happy-dom does not model cross-frame messaging, so the tests drive the
 * host's window listener directly with synthetic MessageEvents whose
 * source/origin we control — exactly the fields the pinning rules check.
 */
function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe;
}

function dispatchMessage(
  data: unknown,
  origin: string,
  source: MessageEventSource | null,
): void {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin, source }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createEmbedHost", () => {
  it("invokes onReady / onRefused for pinned messages from the frame", () => {
    const iframe = makeIframe();
    const onReady = vi.fn();
    const onRefused = vi.fn();
    const host = createEmbedHost(iframe, FRAME_ORIGIN, { onReady, onRefused });

    dispatchMessage(toWire({ type: "ready" }), FRAME_ORIGIN, iframe.contentWindow);
    dispatchMessage(toWire({ type: "refused" }), FRAME_ORIGIN, iframe.contentWindow);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(1);
    host.destroy();
  });

  it("ignores messages from the right origin but the wrong window", () => {
    const iframe = makeIframe();
    const other = makeIframe();
    const onReady = vi.fn();
    const host = createEmbedHost(iframe, FRAME_ORIGIN, { onReady });

    dispatchMessage(toWire({ type: "ready" }), FRAME_ORIGIN, other.contentWindow);

    expect(onReady).not.toHaveBeenCalled();
    host.destroy();
  });

  it("ignores messages from the right window but the wrong origin", () => {
    const iframe = makeIframe();
    const onReady = vi.fn();
    const host = createEmbedHost(iframe, FRAME_ORIGIN, { onReady });

    dispatchMessage(
      toWire({ type: "ready" }),
      "https://evil.example",
      iframe.contentWindow,
    );

    expect(onReady).not.toHaveBeenCalled();
    host.destroy();
  });

  it("answers hello with init posted to the pinned frame origin", () => {
    const iframe = makeIframe();
    const host = createEmbedHost(iframe, FRAME_ORIGIN);
    // Stubbed (not called through): happy-dom's about:blank frame would
    // reject the cross-origin target that a real chat frame accepts.
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);

    dispatchMessage(toWire({ type: "hello" }), FRAME_ORIGIN, iframe.contentWindow);

    expect(postMessage).toHaveBeenCalledWith(
      toWire({ type: "init" }),
      FRAME_ORIGIN,
    );
    host.destroy();
  });

  it("stops reacting after destroy", () => {
    const iframe = makeIframe();
    const onReady = vi.fn();
    const host = createEmbedHost(iframe, FRAME_ORIGIN, { onReady });

    host.destroy();
    dispatchMessage(toWire({ type: "ready" }), FRAME_ORIGIN, iframe.contentWindow);

    expect(onReady).not.toHaveBeenCalled();
  });
});
