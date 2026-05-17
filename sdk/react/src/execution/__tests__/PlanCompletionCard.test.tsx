import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { PlanCompletionCard } from "../PlanCompletionCard";

describe("PlanCompletionCard", () => {
  it("renders the card with status text and implement button", () => {
    const { container } = render(<PlanCompletionCard onImplement={() => {}} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-label")).toBe("Plan complete");

    const button = root.querySelector("button");
    expect(button).toBeTruthy();
    expect(button!.textContent).toContain("Implement");

    expect(root.textContent).toContain("Plan complete");
    cleanup();
  });

  it("calls onImplement when the button is clicked", () => {
    const onImplement = vi.fn();
    const { container } = render(<PlanCompletionCard onImplement={onImplement} />);

    const button = container.querySelector("button")!;
    fireEvent.click(button);

    expect(onImplement).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders nothing when onImplement is not provided", () => {
    const { container } = render(<PlanCompletionCard />);

    expect(container.firstChild).toBeNull();
    cleanup();
  });

  it("disables the button when disabled prop is true", () => {
    const { container } = render(<PlanCompletionCard onImplement={() => {}} disabled />);

    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    cleanup();
  });

  it("does not fire onImplement when disabled and clicked", () => {
    const onImplement = vi.fn();
    const { container } = render(<PlanCompletionCard onImplement={onImplement} disabled />);

    const button = container.querySelector("button")!;
    fireEvent.click(button);

    expect(onImplement).not.toHaveBeenCalled();
    cleanup();
  });

  it("has role=status and aria-label for accessibility", () => {
    const { container } = render(<PlanCompletionCard onImplement={() => {}} />);

    const statusEl = container.querySelector("[role='status']");
    expect(statusEl).toBeTruthy();
    expect(statusEl!.getAttribute("aria-label")).toBe("Plan complete");
    cleanup();
  });
});
