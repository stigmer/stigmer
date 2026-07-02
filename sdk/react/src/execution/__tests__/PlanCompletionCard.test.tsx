import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { PlanCompletionCard } from "../PlanCompletionCard";

describe("PlanCompletionCard", () => {
  it("renders the card with status text and a 'Build from plan' button", () => {
    const { container } = render(<PlanCompletionCard onImplement={() => {}} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-label")).toBe("Plan complete");

    const button = root.querySelector("button");
    expect(button).toBeTruthy();
    expect(button!.textContent).toContain("Build from plan");

    expect(root.textContent).toContain("Plan complete");
    cleanup();
  });

  it("fires onImplement on Cmd/Ctrl+Enter from within the card", () => {
    const onImplement = vi.fn();
    const { container } = render(
      <PlanCompletionCard onImplement={onImplement} />,
    );

    const root = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(root, { key: "Enter", metaKey: true });
    fireEvent.keyDown(root, { key: "Enter", ctrlKey: true });
    expect(onImplement).toHaveBeenCalledTimes(2);

    // A plain Enter must not trigger it.
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onImplement).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("does not fire the accelerator when disabled", () => {
    const onImplement = vi.fn();
    const { container } = render(
      <PlanCompletionCard onImplement={onImplement} disabled />,
    );

    const root = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(root, { key: "Enter", metaKey: true });
    expect(onImplement).not.toHaveBeenCalled();
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
