/**
 * Proves the strip above the composer is S18's shaded card, as his ruling
 * of 2026-11-14 set every strip: the muted fill, rounded, the 12/16 words
 * inside it, no hairline over it and no edge of its own (the session view
 * stacks the strips on the composer's gutter); and that an opening strip
 * draws what it holds inside the same card. The auto-approve strip is
 * monochrome: a plain shield in the muted tone and a muted Turn off.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ComposerStrip } from "../ComposerStrip";
import { AutoApproveIndicator } from "../AutoApproveIndicator";

afterEach(cleanup);

describe("ComposerStrip", () => {
  it("is a shaded, rounded card with no hairline and no edge of its own", () => {
    render(
      <ComposerStrip role="status" icon={<span />}>
        Reconnecting…
      </ComposerStrip>,
    );
    const classes = screen.getByRole("status").className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["stg:rounded-lg", "stg:bg-muted", "stg:px-3"]));
    expect(classes).not.toContain("stg:border-t");
    expect(classes).not.toContain("stg:px-4");
    expect(screen.getByText("Reconnecting…").parentElement!.className).toContain("stg:text-sm");
  });

  it("draws what an open strip holds inside the card", () => {
    render(
      <ComposerStrip role="region" aria-label="Files" icon={<span />} onToggle={vi.fn()} expanded below={<p>a.ts</p>}>
        Changing 1 file
      </ComposerStrip>,
    );
    const card = screen.getByRole("region", { name: "Files" });
    expect(card.contains(screen.getByText("a.ts"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
  });
});

describe("AutoApproveIndicator", () => {
  it("draws a plain muted shield with no tick, and a muted Turn off", () => {
    render(<AutoApproveIndicator onTurnOff={vi.fn()} />);
    const strip = screen.getByRole("status");
    const shield = strip.querySelector("svg")!;
    expect(shield.getAttribute("class")).toContain("stg:text-muted-foreground");
    expect(shield.getAttribute("class")).not.toContain("stg:text-status-ready");
    expect(shield.querySelectorAll("path")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Turn off" }).className).toContain("stg:text-muted-foreground");
  });
});
