/**
 * The theming playground on the theming docs page: the real `MessageThread`
 * rendering one fixed run (a prompt, a thinking card, a reply with a tool
 * call, and a pending approval) inside a `.stgm` scope the reader restyles.
 *
 * Pins the contract the page's prose makes: the conversation and its
 * approval gate are there to look at; picking a preset swaps only the scope's
 * preset class; the colour mode follows the docs (dark) until the reader
 * picks one; and deciding the approval does nothing, because there is no run
 * behind it, so the gate stays on screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemingPlayground } from "../index";

afterEach(cleanup);

/** The `.stgm` element the switchers restyle: the thread's log sits inside it. */
function themeScope(): HTMLElement {
  const scope = screen.getByRole("log").closest("[data-stgm-color-mode]");
  if (!(scope instanceof HTMLElement)) throw new Error("the thread is not inside a theme scope");
  return scope;
}

describe("ThemingPlayground", () => {
  it("renders the fixed conversation and its pending approval", () => {
    render(<ThemingPlayground />);

    const thread = screen.getByRole("log");
    expect(within(thread).getByRole("article", { name: "User message" }).textContent).toContain(
      "Can you clean up the stale feature flags in the billing service?",
    );
    expect(screen.getByRole("alert", { name: "Approval required for delete_file" })).toBeTruthy();
  });

  it("swaps the scope's preset class when the reader picks a preset", () => {
    render(<ThemingPlayground />);
    expect(themeScope().className).not.toContain("stgm-theme-");

    fireEvent.click(screen.getByRole("button", { name: "Fintech" }));

    expect(themeScope().className).toContain("stgm-theme-fintech");
    expect(screen.getByRole("button", { name: "Fintech" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Default" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("follows the docs' dark mode until the reader picks light", () => {
    render(<ThemingPlayground />);
    expect(themeScope().getAttribute("data-stgm-color-mode")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "light" }));

    expect(themeScope().getAttribute("data-stgm-color-mode")).toBe("light");
    expect(screen.getByRole("button", { name: "light" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the approval gate on screen when the reader approves", () => {
    render(<ThemingPlayground />);
    const gate = screen.getByRole("alert", { name: "Approval required for delete_file" });

    fireEvent.click(within(gate).getByRole("button", { name: /^Approve$/ }));

    expect(screen.getByRole("alert", { name: "Approval required for delete_file" })).toBeTruthy();
  });
});
