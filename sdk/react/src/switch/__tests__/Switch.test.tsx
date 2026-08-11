import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Switch } from "../Switch";

afterEach(cleanup);

describe("Switch", () => {
  it("renders as role=switch with aria-checked reflecting state", () => {
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} aria-label="Enable sharing" />,
    );

    const el = screen.getByRole("switch", { name: "Enable sharing" });
    expect(el.getAttribute("aria-checked")).toBe("false");

    rerender(
      <Switch checked onCheckedChange={() => {}} aria-label="Enable sharing" />,
    );
    expect(el.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onCheckedChange with the next value on click", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Enable sharing" />,
    );

    screen.getByRole("switch").click();
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("calls onCheckedChange(false) when toggling off", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch checked onCheckedChange={onCheckedChange} aria-label="Enable sharing" />,
    );

    screen.getByRole("switch").click();
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("is a native button, so Space/Enter activation comes from the platform", () => {
    render(
      <Switch checked={false} onCheckedChange={() => {}} aria-label="Enable sharing" />,
    );

    const el = screen.getByRole("switch");
    // happy-dom does not synthesize click from keydown; assert the native
    // button element carries the behavior instead of re-implementing it.
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
  });

  it("does not fire when disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled
        aria-label="Enable sharing"
      />,
    );

    const el = screen.getByRole("switch") as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    el.click();
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("fills the track with the contract-audited surface tokens", () => {
    // bg-input (off) / bg-primary (on) are registered as surface pairs in
    // the @stigmer/theme contrast contract — bg-muted is NOT valid here (it
    // matches the popover surface in dark presets, making the track
    // invisible inside dialogs).
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} aria-label="Enable sharing" />,
    );

    const el = screen.getByRole("switch");
    expect(el.className).toContain("stg:bg-input");
    expect(el.className).not.toContain("stg:bg-muted");

    rerender(
      <Switch checked onCheckedChange={() => {}} aria-label="Enable sharing" />,
    );
    expect(el.className).toContain("stg:bg-primary");
  });

  it("supports aria-labelledby for external labels", () => {
    render(
      <>
        <span id="share-label">Enable sharing</span>
        <Switch
          checked={false}
          onCheckedChange={() => {}}
          aria-labelledby="share-label"
        />
      </>,
    );

    expect(
      screen.getByRole("switch", { name: "Enable sharing" }),
    ).toBeTruthy();
  });
});
