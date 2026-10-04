import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  StigmerAgentElement,
  defineStigmerAgent,
  setDefaultAppOrigin,
} from "../element.js";
import { toWire } from "../protocol.js";

const APP_ORIGIN = "https://app.stigmer.example";

beforeAll(() => {
  defineStigmerAgent();
});

afterEach(() => {
  document.body.innerHTML = "";
  setDefaultAppOrigin(APP_ORIGIN);
});

function mount(attributes: Record<string, string>): StigmerAgentElement {
  const element = document.createElement("stigmer-agent") as StigmerAgentElement;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  return element;
}

function iframeOf(element: StigmerAgentElement): HTMLIFrameElement | null {
  return element.querySelector("iframe");
}

describe("<stigmer-agent>", () => {
  it("registers exactly once, tolerating repeat define calls", () => {
    defineStigmerAgent();
    expect(customElements.get("stigmer-agent")).toBe(StigmerAgentElement);
  });

  it("renders an iframe onto the hosted chat page for the share", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ share: "ash_support" });

    const iframe = iframeOf(element);
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe(`${APP_ORIGIN}/chat/ash_support`);
    expect(iframe!.title).toBe("Chat with a shared agent");
    expect(element.style.width).toBe("400px");
    expect(element.style.height).toBe("600px");
  });

  it("honors width/height (bare numbers become px) and explicit themes", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({
      share: "ash_support",
      width: "320",
      height: "80vh",
      theme: "dark",
    });

    expect(element.style.width).toBe("320px");
    expect(element.style.height).toBe("80vh");
    expect(iframeOf(element)!.src).toBe(
      `${APP_ORIGIN}/chat/ash_support?theme=dark`,
    );
  });

  it("forwards the token attribute as ?k= on the iframe URL (locked link)", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({
      share: "ash_support",
      token: "tok123",
      theme: "dark",
    });

    // The hosted page reads ?k= and forwards it on its guest mint; the
    // token must ride BEFORE theme so the URL matches the SDK's shape.
    expect(iframeOf(element)!.src).toBe(
      `${APP_ORIGIN}/chat/ash_support?k=tok123&theme=dark`,
    );
  });

  it("prefers the app-origin attribute over the loader default", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({
      share: "ash_support",
      "app-origin": "https://selfhosted.example",
    });

    expect(iframeOf(element)!.src).toBe(
      "https://selfhosted.example/chat/ash_support",
    );
  });

  it("URL-encodes the share path segment", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ share: "ash one/two" });

    expect(iframeOf(element)!.src).toBe(`${APP_ORIGIN}/chat/ash%20one%2Ftwo`);
  });

  it("renders nothing (with a console error) when required config is missing", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const missingShare = mount({});
    expect(iframeOf(missingShare)).toBeNull();

    setDefaultAppOrigin("");
    const missingOrigin = mount({ share: "ash_support" });
    expect(iframeOf(missingOrigin)).toBeNull();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("hides itself and dispatches stigmer:refused when the frame reports refusal", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ share: "ash_support" });
    const refused = vi.fn();
    element.addEventListener("stigmer:refused", refused);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: toWire({ type: "refused" }),
        origin: APP_ORIGIN,
        source: iframeOf(element)!.contentWindow,
      }),
    );

    expect(element.style.display).toBe("none");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("dispatches stigmer:ready when the frame reports readiness", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ share: "ash_support" });
    const ready = vi.fn();
    element.addEventListener("stigmer:ready", ready);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: toWire({ type: "ready" }),
        origin: APP_ORIGIN,
        source: iframeOf(element)!.contentWindow,
      }),
    );

    expect(ready).toHaveBeenCalledTimes(1);
    expect(element.style.display).toBe("inline-block");
  });

  it("tears down its iframe and bridge on disconnect", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ share: "ash_support" });
    const ready = vi.fn();
    element.addEventListener("stigmer:ready", ready);
    const frameWindow = iframeOf(element)!.contentWindow;

    element.remove();

    expect(iframeOf(element)).toBeNull();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: toWire({ type: "ready" }),
        origin: APP_ORIGIN,
        source: frameWindow,
      }),
    );
    expect(ready).not.toHaveBeenCalled();
  });
});
