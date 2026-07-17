// Contract tests for the shared thread-card shell (T05): the chrome axes
// (bordered vs divider row, selection ring, gate accent), the per-surface
// header gestures with their ARIA semantics, and the nested-button keydown
// guard. The two consuming threads pin their own compositions; this file
// pins what they share.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardBody,
} from "../thread-card/index.js";

afterEach(cleanup);

describe("ThreadCardShell chrome", () => {
  it("renders a bordered card by default and a divider row when nested", () => {
    const { rerender, container } = render(
      <ThreadCardShell cursorTarget="row">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    const root = () =>
      container.querySelector('[data-cursor-target="row"]') as HTMLElement;
    expect(root().className).toContain("border-border-prominent");

    rerender(
      <ThreadCardShell cursorTarget="row" bordered={false}>
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    expect(root().className).toContain("border-b");
    expect(root().className).not.toContain("border-border-prominent");
  });

  it("carries the selection ring and the gate accent", () => {
    const { container } = render(
      <ThreadCardShell cursorTarget="row" selected accent="warning">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    const root = container.querySelector('[data-cursor-target="row"]') as HTMLElement;
    expect(root.className).toContain("ring-primary/40");
    expect(root.className).toContain("border-l-warning");
  });
});

describe("ThreadCardHeader gestures", () => {
  it("expand gesture: aria-expanded header toggling on click and keyboard", () => {
    const onToggle = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "expand", expanded: false, onToggle }}>
        row content
      </ThreadCardHeader>,
    );
    const header = screen.getByRole("button");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(header);
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it("select gesture: aria-pressed header", () => {
    const onSelect = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "select", selected: true, onSelect }}>
        row content
      </ThreadCardHeader>,
    );
    const header = screen.getByRole("button");
    expect(header.getAttribute("aria-pressed")).toBe("true");
    expect(header.getAttribute("aria-expanded")).toBeNull();

    fireEvent.click(header);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a nested action button's Enter never doubles as the header gesture", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "select", selected: false, onSelect }}>
        <button
          type="button"
          aria-label="Inspect"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
        >
          i
        </button>
      </ThreadCardHeader>,
    );

    const nested = screen.getByRole("button", { name: "Inspect" });
    // The keydown bubbles to the header, whose guard must ignore it because
    // the event target is the nested button, not the header itself.
    fireEvent.keyDown(nested, { key: "Enter" });
    fireEvent.click(nested);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("none gesture renders a non-interactive layout row", () => {
    render(<ThreadCardHeader>plain content</ThreadCardHeader>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ThreadCardBody", () => {
  it("carries the id for aria-controls wiring", () => {
    render(<ThreadCardBody id="detail-1">body</ThreadCardBody>);
    expect(document.getElementById("detail-1")?.textContent).toBe("body");
  });
});
