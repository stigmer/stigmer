import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import GlobalError from "../app/global-error";

afterEach(() => cleanup());

describe("GlobalError", () => {
  it("renders error heading and try again button", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("test"), { digest: "abc123" });

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("An unexpected error occurred.")).toBeTruthy();
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
