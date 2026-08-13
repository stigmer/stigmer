// Contract tests for the shared thread-card shell (T05/T06): the chrome
// tiers (card / nested divider row / quiet unboxed line, gate accent), the
// header gestures (`expand` / `none` — `select` died with the Inspect
// drill-down, T06) with their ARIA semantics, and the nested-button keydown
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
  it("renders a bordered card by default, a divider row when nested, and no chrome when quiet", () => {
    const { rerender, container } = render(
      <ThreadCardShell cursorTarget="row">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    const root = () =>
      container.querySelector('[data-cursor-target="row"]') as HTMLElement;
    expect(root().className).toContain("stg:border-border-prominent");

    rerender(
      <ThreadCardShell cursorTarget="row" variant="row">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    expect(root().className).toContain("stg:border-b");
    expect(root().className).not.toContain("stg:border-border-prominent");

    rerender(
      <ThreadCardShell cursorTarget="row" variant="quiet">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    // The quiet tier is an unboxed line: no card border, no divider.
    expect(root().className).not.toContain("stg:border-border-prominent");
    expect(root().className).not.toContain("stg:border-b");
    expect(root().className).not.toContain("stg:rounded-lg");
  });

  it("carries the gate accent", () => {
    const { container } = render(
      <ThreadCardShell cursorTarget="row" accent="warning">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    const root = container.querySelector('[data-cursor-target="row"]') as HTMLElement;
    expect(root.className).toContain("stg:border-l-warning");
  });

  it("never draws the gate accent on a quiet shell — escalation is the caller's job", () => {
    // The quiet tier deliberately ignores `accent`: a gated row must be
    // escalated to variant="card" by its component, never rendered as an
    // accented bare line (see ThreadCardVariant).
    const { container } = render(
      <ThreadCardShell cursorTarget="row" variant="quiet" accent="warning">
        <ThreadCardHeader>content</ThreadCardHeader>
      </ThreadCardShell>,
    );
    const root = container.querySelector('[data-cursor-target="row"]') as HTMLElement;
    expect(root.className).not.toContain("stg:border-l-warning");
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

  it("a nested action button's Enter never doubles as the header gesture", () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "expand", expanded: false, onToggle }}>
        <button
          type="button"
          aria-label="Copy"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
        >
          c
        </button>
      </ThreadCardHeader>,
    );

    const nested = screen.getByRole("button", { name: "Copy" });
    // The keydown bubbles to the header, whose guard must ignore it because
    // the event target is the nested button, not the header itself.
    fireEvent.keyDown(nested, { key: "Enter" });
    fireEvent.click(nested);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
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

  it("swaps the card padding for a left rail when the body is quiet-contained", () => {
    const { rerender } = render(<ThreadCardBody id="detail-1">body</ThreadCardBody>);
    const el = () => document.getElementById("detail-1")!;
    expect(el().className).not.toContain("stg:border-l-2");

    rerender(
      <ThreadCardBody id="detail-1" rail>
        body
      </ThreadCardBody>,
    );
    expect(el().className).toContain("stg:border-l-2");
  });
});
