import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { AskAiProvider } from "../AskAiProvider";
import { AskAiTrigger } from "../AskAiTrigger";
import { AskAiPanel } from "../AskAiPanel";
import {
  ASK_AI_AGENT,
  ASK_AI_APP_ORIGIN,
  ASK_AI_ORG,
  ASK_AI_READY_TIMEOUT_MS,
} from "../config";

/**
 * The docs layout shape: one provider, two triggers, one panel. Both
 * triggers live in DocsHeader (DD-02) — `header` on desktop, `nav` on the
 * mobile cluster — CSS-gated by breakpoint.
 */
function Harness() {
  return (
    <AskAiProvider>
      <AskAiTrigger variant="header" className="max-md:hidden" />
      <AskAiTrigger variant="nav" className="md:hidden" />
      <AskAiPanel />
    </AskAiProvider>
  );
}

function openPanel(): void {
  fireEvent.click(screen.getAllByRole("button", { name: "Ask AI" })[0]);
}

function embedElement(): Element | null {
  return document.querySelector("stigmer-agent");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AskAiPanel", () => {
  it("never mounts the embed (no guest mint) until first opened", () => {
    render(<Harness />);

    expect(embedElement()).toBe(null);
  });

  it("mounts exactly one embed with the share's coordinates on first open", () => {
    render(<Harness />);
    openPanel();

    const elements = document.querySelectorAll("stigmer-agent");
    expect(elements.length).toBe(1);

    const element = elements[0];
    expect(element.getAttribute("org")).toBe(ASK_AI_ORG);
    expect(element.getAttribute("agent")).toBe(ASK_AI_AGENT);
    expect(element.getAttribute("app-origin")).toBe(ASK_AI_APP_ORIGIN);
    expect(element.getAttribute("theme")).toBe("dark");
    expect(element.getAttribute("width")).toBe("100%");
    expect(element.getAttribute("height")).toBe("100%");
  });

  it("builds the hosted chat iframe against the configured app origin", () => {
    render(<Harness />);
    openPanel();

    const iframe = embedElement()?.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe!.src).toBe(
      `${ASK_AI_APP_ORIGIN}/chat/${ASK_AI_ORG}/${ASK_AI_AGENT}?theme=dark`,
    );
  });

  it("keeps the same embed instance (same conversation) across close and reopen", () => {
    render(<Harness />);
    openPanel();
    const first = embedElement();
    expect(first).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close Ask AI" }));
    // keepMounted: closing hides the panel but must not unmount the iframe.
    expect(embedElement()).toBe(first);

    openPanel();
    expect(embedElement()).toBe(first);
  });

  it("keeps every embed attribute stable across re-renders", () => {
    const { rerender } = render(<Harness />);
    openPanel();
    const element = embedElement();
    // The theme attribute is the site-wide dark constant — which satisfies
    // the element's contract that no attribute ever changes mid-conversation
    // (any change rebuilds the iframe and wipes the chat).
    expect(element!.getAttribute("theme")).toBe("dark");
    const iframe = element!.querySelector("iframe");

    rerender(<Harness />);

    // Attribute unchanged, element instance unchanged, iframe instance
    // unchanged — any of the three changing means the conversation died.
    expect(embedElement()).toBe(element);
    expect(element!.getAttribute("theme")).toBe("dark");
    expect(element!.querySelector("iframe")).toBe(iframe);
  });

  it("shows a connecting cover until the embed reports ready", () => {
    render(<Harness />);
    openPanel();

    expect(screen.getByText("Connecting to Ask AI…")).toBeTruthy();

    act(() => {
      embedElement()!.dispatchEvent(new CustomEvent("stigmer:ready"));
    });

    expect(screen.queryByText("Connecting to Ask AI…")).toBe(null);
    expect(embedElement()).toBeTruthy();
  });

  it("replaces a refused embed with an explanation and escape hatches", () => {
    render(<Harness />);
    openPanel();

    act(() => {
      embedElement()!.dispatchEvent(new CustomEvent("stigmer:refused"));
    });

    expect(screen.getByText(/isn't available right now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    const issueLink = screen.getByRole("link", { name: "Report an issue" });
    expect(issueLink.getAttribute("href")).toContain("/issues/new");
    expect(issueLink.getAttribute("rel")).toContain("noopener");
    // The element hides itself on refusal; the panel must not leave the
    // silently hidden widget in place behind the fallback.
    expect(embedElement()).toBe(null);
  });

  it("declares the embed unavailable when nothing answers within the timeout", () => {
    vi.useFakeTimers();
    render(<Harness />);
    openPanel();

    act(() => {
      vi.advanceTimersByTime(ASK_AI_READY_TIMEOUT_MS + 1);
    });

    expect(screen.getByText(/isn't available right now/)).toBeTruthy();
  });

  it("retry rebuilds a fresh embed", () => {
    render(<Harness />);
    openPanel();
    const first = embedElement();

    act(() => {
      first!.dispatchEvent(new CustomEvent("stigmer:refused"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const second = embedElement();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(screen.getByText("Connecting to Ask AI…")).toBeTruthy();
  });

  it("marks the triggers as controlling a dialog", () => {
    render(<Harness />);

    const triggers = screen.getAllByRole("button", { name: "Ask AI" });
    expect(triggers.length).toBe(2);
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }

    openPanel();
    for (const trigger of screen.getAllByRole("button", { name: "Ask AI" })) {
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    }
  });
});
