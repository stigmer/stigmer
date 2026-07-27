import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionViewerLayout } from "../SessionViewerLayout";

// ---------------------------------------------------------------------------
// The one conversation-plus-panel frame both shipped viewers render
// (SessionViewer + NewSessionViewer), so the two surfaces cannot drift.
// The contract under test:
//   - `panel` is the single source of truth for collapsed state
//   - the conversation never remounts across an open/close toggle
//   - `responsive={false}` disables the below-`lg` conversation collapse
//     (fixed-canvas hosts: docs embeds, video export)
//   - no `splitStorageKey` means no localStorage read (deterministic hosts)
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function conversation() {
  return <div data-testid="conversation">chat</div>;
}

function panel() {
  return <div data-testid="panel">panel</div>;
}

describe("SessionViewerLayout", () => {
  it("collapsed (panel null): conversation renders, panel absent, no separator exposed", () => {
    render(<SessionViewerLayout conversation={conversation()} panel={null} />);
    expect(screen.getByTestId("conversation").textContent).toBe("chat");
    expect(screen.queryByTestId("panel")).toBeNull();
    // The drag separator is CSS-hidden and aria-hidden while collapsed.
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("open (panel provided): panel renders and the separator is operable", () => {
    render(<SessionViewerLayout conversation={conversation()} panel={panel()} />);
    expect(screen.getByTestId("panel").textContent).toBe("panel");
    const separator = screen.getByRole("separator", { name: "Resize chat panel" });
    expect(separator.getAttribute("tabindex")).toBe("0");
  });

  it("resizeAriaLabel names the separator in the host's vocabulary", () => {
    render(
      <SessionViewerLayout
        conversation={conversation()}
        panel={panel()}
        resizeAriaLabel="Resize composer panel"
      />,
    );
    expect(
      screen.queryByRole("separator", { name: "Resize composer panel" }),
    ).not.toBeNull();
  });

  it("never remounts the conversation across an open/close toggle", () => {
    const { rerender } = render(
      <SessionViewerLayout conversation={conversation()} panel={null} />,
    );
    const node = screen.getByTestId("conversation");

    rerender(<SessionViewerLayout conversation={conversation()} panel={panel()} />);
    expect(screen.getByTestId("conversation")).toBe(node);

    rerender(<SessionViewerLayout conversation={conversation()} panel={null} />);
    expect(screen.getByTestId("conversation")).toBe(node);
  });

  it("open panel sizes the conversation pane at the shared default width", () => {
    render(<SessionViewerLayout conversation={conversation()} panel={panel()} />);
    const pane = screen.getByTestId("conversation").parentElement!;
    expect(pane.style.width).toBe("420px");
  });

  it("responsive (default): the open-panel conversation pane collapses below lg", () => {
    const { container } = render(
      <SessionViewerLayout conversation={conversation()} panel={panel()} />,
    );
    const pane = screen.getByTestId("conversation").parentElement!;
    expect(pane.className).toContain("max-lg:hidden");
    // The separator hides with it, so the panel is the full row below lg.
    expect(container.querySelectorAll('[class*="max-lg:hidden"]').length).toBe(2);
  });

  it("responsive={false}: no below-lg collapse anywhere (fixed-canvas hosts)", () => {
    const { container } = render(
      <SessionViewerLayout
        conversation={conversation()}
        panel={panel()}
        responsive={false}
      />,
    );
    expect(container.querySelector('[class*="max-lg:hidden"]')).toBeNull();
  });

  it("reads no localStorage without a splitStorageKey (deterministic hosts)", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(<SessionViewerLayout conversation={conversation()} panel={panel()} />);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("seeds the pane width from the host's splitStorageKey when given", () => {
    localStorage.setItem("stgm-test-chat-width", "512");
    render(
      <SessionViewerLayout
        conversation={conversation()}
        panel={panel()}
        splitStorageKey="stgm-test-chat-width"
      />,
    );
    const pane = screen.getByTestId("conversation").parentElement!;
    expect(pane.style.width).toBe("512px");
  });

  it("renders headerActions beside the chip in the top-right corner", () => {
    render(
      <SessionViewerLayout
        conversation={conversation()}
        panel={null}
        headerActions={<button type="button">Share</button>}
        chip={<button type="button">Toggle panel</button>}
      />,
    );
    const actions = screen.getByRole("button", { name: "Share" });
    const chip = screen.getByRole("button", { name: "Toggle panel" });
    expect(actions.parentElement).toBe(chip.parentElement);
  });

  it("renders no control corner when both chip and headerActions are omitted", () => {
    const { container } = render(
      <SessionViewerLayout conversation={conversation()} panel={null} />,
    );
    // The corner is the only `top-2`-positioned element in the layout (the
    // separator's inner hit target is also `absolute`, so match the corner).
    expect(container.querySelector('[class*="top-2"]')).toBeNull();
  });
});
