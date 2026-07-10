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

  it("renders an iframe onto the hosted chat page for org/agent", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ org: "acme", agent: "support-bot" });

    const iframe = iframeOf(element);
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe(`${APP_ORIGIN}/chat/acme/support-bot`);
    expect(element.style.width).toBe("400px");
    expect(element.style.height).toBe("600px");
  });

  it("honors width/height (bare numbers become px) and explicit themes", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({
      org: "acme",
      agent: "support-bot",
      width: "320",
      height: "80vh",
      theme: "dark",
    });

    expect(element.style.width).toBe("320px");
    expect(element.style.height).toBe("80vh");
    expect(iframeOf(element)!.src).toBe(
      `${APP_ORIGIN}/chat/acme/support-bot?theme=dark`,
    );
  });

  it("prefers the app-origin attribute over the loader default", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({
      org: "acme",
      agent: "support-bot",
      "app-origin": "https://selfhosted.example",
    });

    expect(iframeOf(element)!.src).toBe(
      "https://selfhosted.example/chat/acme/support-bot",
    );
  });

  it("URL-encodes org and agent path segments", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ org: "acme co", agent: "bot/one" });

    expect(iframeOf(element)!.src).toBe(
      `${APP_ORIGIN}/chat/acme%20co/bot%2Fone`,
    );
  });

  it("renders nothing (with a console error) when required config is missing", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const missingAgent = mount({ org: "acme" });
    expect(iframeOf(missingAgent)).toBeNull();

    setDefaultAppOrigin("");
    const missingOrigin = mount({ org: "acme", agent: "support-bot" });
    expect(iframeOf(missingOrigin)).toBeNull();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("hides itself and dispatches stigmer:refused when the frame reports refusal", () => {
    setDefaultAppOrigin(APP_ORIGIN);
    const element = mount({ org: "acme", agent: "support-bot" });
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
    const element = mount({ org: "acme", agent: "support-bot" });
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
    const element = mount({ org: "acme", agent: "support-bot" });
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
