/**
 * Proves the one plan card (../PlanCard.tsx) every plan surface in the
 * thread draws on: a muted square with a list glyph, the plan's title and a
 * subline, the acts at the right. Each state says its own words and offers
 * only its own acts: writing ("Writing the plan…", with the live sweep;
 * Open alone), ready ("Plan · 4.1 KB"; Open, Copy, Download,
 * Build), replaced ("Replaced by a newer plan"; Open and Copy, never Build)
 * and a plan held only as message text (its text under the header, and
 * Build). Build is offered only on a ready plan or one with no File, and
 * calls what it was handed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PlanCard, type PlanCardProps } from "../PlanCard";

afterEach(cleanup);

/** Every act handed in, so each state shows only the ones it offers. */
function everyAct(): Pick<PlanCardProps, "open" | "copy" | "download" | "build"> {
  return {
    open: { label: "Open plan", onClick: vi.fn() },
    copy: { label: "Copy plan", onClick: vi.fn() },
    download: { label: "Download plan", onClick: vi.fn() },
    build: { onClick: vi.fn() },
  };
}

/** The accessible names of the card's buttons, in order. */
function buttonNames(): (string | null)[] {
  return screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("PlanCard", () => {
  it("says a plan being written, with the live sweep, with Open alone", () => {
    render(<PlanCard state="writing" title="Fix invoice rounding" {...everyAct()} />);
    expect(screen.getByText("Fix invoice rounding").className).toContain("stg:font-semibold");
    const subline = screen.getByText("Writing the plan…");
    expect(subline.className).toContain("stgm-shimmer-label");
    expect(buttonNames()).toEqual(["Open plan"]);
    expect(screen.getByRole("button", { name: "Open plan" }).textContent).toBe("Open");
  });

  it("says a ready plan's size as the Made cards say it, and offers Open, Copy, Download and Build", () => {
    const acts = everyAct();
    render(<PlanCard state="ready" title="Fix invoice rounding" sizeBytes={4_210n} {...acts} />);
    expect(screen.getByText("Plan · 4.1 KB")).toBeTruthy();
    expect(buttonNames()).toEqual(["Open plan", "Copy plan", "Download plan", "Build"]);
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(acts.build!.onClick).toHaveBeenCalledTimes(1);
  });

  it("says a ready plan of unknown size only as a plan, in kilobytes when small", () => {
    const { rerender } = render(<PlanCard state="ready" title="T" />);
    expect(screen.getByText("Plan")).toBeTruthy();
    rerender(<PlanCard state="ready" title="T" sizeBytes={312n} />);
    expect(screen.getByText("Plan · 0.3 KB")).toBeTruthy();
  });

  it("says a replaced plan was replaced, and offers Open and Copy but never Build", () => {
    render(<PlanCard state="replaced" title="Fix invoice rounding" sizeBytes={4_210n} {...everyAct()} />);
    expect(screen.getByText("Replaced by a newer plan")).toBeTruthy();
    expect(buttonNames()).toEqual(["Open plan", "Copy plan"]);
  });

  it("draws a plan held only as text under its header, with Build", () => {
    render(<PlanCard state="text" title="Fix invoice rounding" body={<p>Step one</p>} {...everyAct()} />);
    expect(screen.getByText("Step one")).toBeTruthy();
    expect(buttonNames()).toEqual(["Build"]);
  });

  it("reads Build as starting while the build starts, and holds it off while disabled", () => {
    const build = { onClick: vi.fn(), disabled: true, pending: true };
    render(<PlanCard state="ready" title="T" build={build} />);
    const button = screen.getByRole("button", { name: "Starting build…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(build.onClick).not.toHaveBeenCalled();
  });

  it("ticks Copy once copied", () => {
    render(<PlanCard state="ready" title="T" copy={{ label: "Copied", copied: true, onClick: vi.fn() }} />);
    const copied = screen.getByRole("button", { name: "Copied" });
    expect(copied.querySelector("svg")?.getAttribute("class")?.split(" ")).toContain("stg:text-status-ready");
  });

  it("draws the glyph on a 32px muted square", () => {
    const { container } = render(<PlanCard state="ready" title="T" />);
    const square = container.querySelector("[data-plan-glyph]")!;
    expect(square.className.split(" ")).toEqual(expect.arrayContaining(["stg:h-8", "stg:w-8", "stg:bg-muted"]));
  });
});
