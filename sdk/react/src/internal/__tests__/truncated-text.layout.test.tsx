// TruncatedText's overflow gating in a real Chromium (stigmer-cloud#268).
// The native `title` idiom this helper replaced fired whether or not the
// text was actually clipped; the helper opens the house tooltip ONLY when
// CSS truncation really happened. That distinction is a layout fact —
// happy-dom reports zero geometry — so only a real browser can pin it.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import type { ReactElement } from "react";
import { TruncatedText } from "../truncated-text.js";

const LONG = "a-very-long-model-identifier/that-cannot-fit-in-eighty-pixels";
const SHORT = "fits";

/** A themed, hard-sized cell so truncation geometry is real. */
function renderInCell(ui: ReactElement, width: string) {
  const cell = document.createElement("div");
  cell.className = "stgm";
  cell.style.width = width;
  cell.style.display = "block";
  document.body.appendChild(cell);
  render(ui, { container: cell });
  return cell;
}

function portaledText(cell: HTMLElement): string {
  return Array.from(document.body.children)
    .filter((node) => node !== cell)
    .map((node) => node.textContent ?? "")
    .join(" ");
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("TruncatedText overflow gating", () => {
  it("reveals the full value on hover when the text is actually clipped", async () => {
    const cell = renderInCell(<TruncatedText text={LONG} />, "80px");
    expect(cell.querySelector("[title]")).toBeNull();

    const span = cell.querySelector("span");
    expect(span!.scrollWidth).toBeGreaterThan(span!.clientWidth);

    await userEvent.hover(span!);
    await vi.waitFor(
      () => expect(portaledText(cell)).toContain(LONG),
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(span!);
  });

  it("stays quiet when nothing is clipped — the tooltip would only repeat the cell", async () => {
    const cell = renderInCell(<TruncatedText text={SHORT} />, "300px");

    const span = cell.querySelector("span");
    await userEvent.hover(span!);
    // Base UI's default open delay is 600ms; wait past it and assert the
    // portal never produced the tooltip.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(portaledText(cell)).not.toContain(SHORT);
    await userEvent.unhover(span!);
  });
});
