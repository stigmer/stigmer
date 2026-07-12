import { afterEach, describe, expect, it, vi } from "vitest";

import { OPAQUE_ORIGIN, notifyParent, resolveParentOrigin } from "../frame.js";
import { toWire } from "../protocol.js";

/**
 * happy-dom runs the suite unframed (window.self === window.top), so framed
 * behavior is exercised by stubbing the browser-owned discovery sources
 * (ancestorOrigins, referrer, parent messaging) rather than real nesting —
 * real cross-origin frames are e2e territory.
 */

const PARENT_ORIGIN = "https://docs.example.com";

function stubAncestorOrigins(...origins: string[]): void {
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    ancestorOrigins: {
      length: origins.length,
      0: origins[0],
      item: (i: number) => origins[i] ?? null,
    },
  } as unknown as Location);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveParentOrigin", () => {
  it("prefers ancestorOrigins when the browser provides it", async () => {
    stubAncestorOrigins(PARENT_ORIGIN);

    await expect(resolveParentOrigin()).resolves.toBe(PARENT_ORIGIN);
  });

  it("falls back to the referrer origin when ancestorOrigins is unavailable", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      `${PARENT_ORIGIN}/pricing/page?x=1`,
    );

    await expect(resolveParentOrigin()).resolves.toBe(PARENT_ORIGIN);
  });

  it("skips an opaque ancestor entry and keeps descending the ladder", async () => {
    stubAncestorOrigins(OPAQUE_ORIGIN);
    vi.spyOn(document, "referrer", "get").mockReturnValue(`${PARENT_ORIGIN}/`);

    await expect(resolveParentOrigin()).resolves.toBe(PARENT_ORIGIN);
  });

  it("uses the loader handshake's event.origin when nothing else is available", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("");
    // The hello goes to window.parent; unframed in happy-dom that is window
    // itself, so the loader's reply is simulated with a parent-sourced event.
    const helloSent = new Promise<void>((resolve) => {
      vi.spyOn(window.parent, "postMessage").mockImplementation(() => {
        resolve();
      });
    });

    const pending = resolveParentOrigin(1_000);
    await helloSent;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: toWire({ type: "init" }),
        origin: PARENT_ORIGIN,
        source: window.parent,
      }),
    );

    await expect(pending).resolves.toBe(PARENT_ORIGIN);
  });

  it("ignores forged init messages that are not from the parent window", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("");
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);

    const pending = resolveParentOrigin(50);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: toWire({ type: "init" }),
        origin: "https://evil.example.com",
        source: iframe.contentWindow,
      }),
    );

    // The forged message must not settle the ladder; the timeout resolves it
    // to the opaque sentinel instead.
    await expect(pending).resolves.toBe(OPAQUE_ORIGIN);
    iframe.remove();
  });

  it("resolves to the opaque sentinel when the handshake times out", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("");
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);

    await expect(resolveParentOrigin(20)).resolves.toBe(OPAQUE_ORIGIN);
  });
});

describe("notifyParent", () => {
  it("targets the discovered parent origin", () => {
    // notifyParent no-ops when unframed, so frame window.top to a distinct
    // object for the duration of the call.
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);

    notifyParent({ type: "ready" }, PARENT_ORIGIN);

    expect(postMessage).toHaveBeenCalledWith(
      toWire({ type: "ready" }),
      PARENT_ORIGIN,
    );
  });

  it("falls back to a wildcard target for an opaque parent", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);

    notifyParent({ type: "refused" }, OPAQUE_ORIGIN);

    expect(postMessage).toHaveBeenCalledWith(toWire({ type: "refused" }), "*");
  });

  it("no-ops when the page is not framed", () => {
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);

    notifyParent({ type: "ready" }, PARENT_ORIGIN);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
