// ---------------------------------------------------------------------------
// The console's Tooltip wrappers over Base UI's tooltip
//
// Pins what callers rely on: the trigger and the popup carry their data
// slots, the popup renders (through its portal) when the tooltip is open
// and not when it is closed, it takes the default popover classes, and a
// caller's className is merged through the design tokens' `cn` so a
// conflicting utility displaces the default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../tooltip";

function renderTooltip(open: boolean, className?: string) {
  return render(
    <TooltipProvider>
      <Tooltip open={open}>
        <TooltipTrigger>New session</TooltipTrigger>
        <TooltipContent className={className}>Start a session</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

describe("Tooltip", () => {
  it("renders the trigger in its slot and no popup while closed", () => {
    renderTooltip(false);
    const trigger = screen.getByText("New session");
    expect(trigger.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(screen.queryByText("Start a session")).toBeNull();
  });

  it("renders the open popup in its slot with the default classes", async () => {
    renderTooltip(true);
    const popup = await waitFor(() => screen.getByText("Start a session"));
    expect(popup.getAttribute("data-slot")).toBe("tooltip-content");
    expect(popup.classList.contains("bg-popover")).toBe(true);
    expect(popup.classList.contains("max-w-64")).toBe(true);
  });

  it("lets a caller's className displace a conflicting default", async () => {
    renderTooltip(true, "max-w-96 font-mono");
    const popup = await waitFor(() => screen.getByText("Start a session"));
    expect(popup.classList.contains("max-w-96")).toBe(true);
    expect(popup.classList.contains("max-w-64")).toBe(false);
    expect(popup.classList.contains("font-mono")).toBe(true);
  });
});
