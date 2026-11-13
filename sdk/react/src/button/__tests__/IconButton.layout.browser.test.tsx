// An icon button's label is shown as a tooltip on hover, in a real
// Chromium: Base UI opens a tooltip on real pointer movement, which only a
// real browser delivers. The happy-dom suite (IconButton.test.tsx) pins the
// name; this one proves a mouse user sees it.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { TooltipProvider } from "../../internal/tooltip.js";
import { IconButton } from "../IconButton.js";

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("IconButton's tooltip", () => {
  it("shows the label on hover, outside the button", async () => {
    const pane = document.createElement("div");
    pane.className = "stgm";
    pane.style.padding = "48px";
    document.body.appendChild(pane);
    const { getByRole } = render(
      <TooltipProvider>
        <IconButton label="Remove Grace Hopper" icon={<svg width="16" height="16" aria-hidden="true" />} />
      </TooltipProvider>,
      { container: pane },
    );
    const trigger = getByRole("button", { name: "Remove Grace Hopper" });
    await userEvent.hover(trigger);
    await vi.waitFor(
      () => {
        const portaled = Array.from(document.body.children)
          .filter((node) => node !== pane)
          .map((node) => node.textContent ?? "")
          .join(" ");
        expect(portaled).toContain("Remove Grace Hopper");
      },
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(trigger);
  });
});
