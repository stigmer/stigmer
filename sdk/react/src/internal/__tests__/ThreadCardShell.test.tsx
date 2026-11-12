// Contract tests for the shared thread-card shell: the chrome
// tiers (card / nested divider row / quiet unboxed line, gate accent), the
// header gestures (`expand` / `none` — `select` died with the Inspect
// drill-down) with their ARIA semantics, the toggle's hint, and the rule
// that a header's own control is the toggle's sibling, never inside it. The
// consuming thread pins its own composition; this file pins what it shares.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardHeaderControl,
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

  it("carries the gate accent on a divider row, so a waiting step in a list keeps it", () => {
    const { container } = render(
      <ThreadCardShell cursorTarget="row" variant="row" accent="destructive">
        <span>x</span>
      </ThreadCardShell>,
    );
    const cls = container.querySelector('[data-cursor-target="row"]')!.className;
    expect(cls).toContain("stg:border-b");
    expect(cls).toContain("stg:border-l-2");
    expect(cls).toContain("stg:border-l-destructive");
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
  it("expand gesture: a native toggle button, named by its label, toggling on click, Enter and Space", async () => {
    const onToggle = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "expand", expanded: false, onToggle, label: "Read a.ts" }}>
        row content
      </ThreadCardHeader>,
    );
    const toggle = screen.getByRole("button", { name: "Read a.ts" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-pressed")).toBeNull();
    expect(toggle.getAttribute("data-cursor-target")).toBe("thread-card-toggle");

    fireEvent.click(toggle);
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it("a header control is the toggle's sibling, never its descendant, and its click and keys stay its own", async () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <ThreadCardHeader gesture={{ kind: "expand", expanded: false, onToggle, label: "Read a.ts" }}>
        <ThreadCardHeaderControl>
          {/* No stopPropagation: the structure alone keeps the toggle out. */}
          <button type="button" aria-label="Copy" onClick={onAction}>
            c
          </button>
        </ThreadCardHeaderControl>
      </ThreadCardHeader>,
    );

    const toggle = screen.getByRole("button", { name: "Read a.ts" });
    const control = screen.getByRole("button", { name: "Copy" });
    expect(toggle.contains(control)).toBe(false);
    expect(toggle.parentElement?.contains(control)).toBe(true);

    fireEvent.click(control);
    control.focus();
    await userEvent.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows the hint on the toggle's focus, and keeps the same button when the hint comes and goes", async () => {
    const gesture = (hint?: string) => ({
      kind: "expand" as const,
      expanded: false,
      onToggle: () => undefined,
      label: "Search invoices",
      ...(hint !== undefined ? { hint } : {}),
    });
    const { rerender } = render(<ThreadCardHeader gesture={gesture()}>row</ThreadCardHeader>);
    const before = screen.getByRole("button", { name: "Search invoices" });

    rerender(<ThreadCardHeader gesture={gesture("invoices from every vendor")}>row</ThreadCardHeader>);
    const toggle = screen.getByRole("button", { name: "Search invoices" });
    expect(toggle, "never remounted, so a focused toggle keeps its focus").toBe(before);

    await userEvent.tab();
    expect(document.activeElement).toBe(toggle);
    expect(await screen.findByText("invoices from every vendor")).toBeTruthy();
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
