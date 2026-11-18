import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import GlobalError from "../app/global-error";

afterEach(() => cleanup());

describe("GlobalError", () => {
  it("says the console stopped working, keeps the reference off the screen, and offers Try again", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("test"), { digest: "abc123" });
    render(<GlobalError error={error} reset={reset} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The console stopped working.");
    expect(alert.textContent).toContain("Your agents and conversations are safe on the server");
    expect(alert.textContent).not.toContain("abc123");
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });

  it("calls reset when try again is clicked", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("test"), { digest: "abc123" });
    render(<GlobalError error={error} reset={reset} />);
    const buttons = screen.getAllByRole("button", { name: "Try again" });
    fireEvent.click(buttons[0]);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
