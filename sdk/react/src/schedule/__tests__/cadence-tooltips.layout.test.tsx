// The disabled-control tooltip contract from the native-title sweep
// (stigmer-cloud#268), pinned in a real Chromium on CadenceField's
// weekday toggles — the sweep's canonical "explanation on a disabled
// control" site. Browsers suppress pointer events on disabled form
// controls, so the old native `title` was unreachable by EVERY input
// method exactly when it mattered (the always-disabled last selected
// day). The fix hangs the house tooltip off a wrapper span; this suite
// proves a mouse user really gets the reason while the button is
// disabled.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { CadenceField } from "../CadenceField.js";

function renderWeekly() {
  const pane = document.createElement("div");
  pane.className = "stgm";
  pane.style.width = "480px";
  document.body.appendChild(pane);
  render(
    <CadenceField
      value={{ kind: "weekly", days: [1], hour: 9, minute: 0 }}
      onChange={() => {}}
    />,
    { container: pane },
  );
  return pane;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("CadenceField disabled-day tooltip", () => {
  it("explains the locked last-selected day on hover while the button is disabled", async () => {
    const pane = renderWeekly();
    expect(pane.querySelector("[title]")).toBeNull();

    const monday = Array.from(pane.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === "Monday",
    );
    expect(monday!.disabled).toBe(true);

    // Hover the wrapper span — the disabled button itself receives no
    // pointer events, which is the entire reason the wrapper exists.
    const wrapper = monday!.parentElement!;
    await userEvent.hover(wrapper);
    await vi.waitFor(
      () => {
        const portaled = Array.from(document.body.children)
          .filter((node) => node !== pane)
          .map((node) => node.textContent ?? "")
          .join(" ");
        expect(portaled).toContain("A weekly schedule needs at least one day");
      },
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(wrapper);
  });

  it("names an enabled weekday on hover", async () => {
    const pane = renderWeekly();

    const tuesday = Array.from(pane.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === "Tuesday",
    );
    expect(tuesday!.disabled).toBe(false);

    await userEvent.hover(tuesday!.parentElement!);
    await vi.waitFor(
      () => {
        const portaled = Array.from(document.body.children)
          .filter((node) => node !== pane)
          .map((node) => node.textContent ?? "")
          .join(" ");
        expect(portaled).toContain("Tuesday");
      },
      { timeout: 3000, interval: 50 },
    );
    await userEvent.unhover(tuesday!.parentElement!);
  });
});
