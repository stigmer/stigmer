import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ApprovalPeekBar } from "../ApprovalPeekBar";

afterEach(cleanup);

describe("ApprovalPeekBar", () => {
  it("is interactive and labelled when visible", () => {
    render(<ApprovalPeekBar visible count={1} onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-hidden")).toBe("false");
    expect(btn.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("1 approval needed")).toBeTruthy();
  });

  it("is inert (mounted for transitions) when not visible", () => {
    render(<ApprovalPeekBar visible={false} count={2} onClick={() => {}} />);
    const btn = screen.getByRole("button", { hidden: true });
    expect(btn.getAttribute("aria-hidden")).toBe("true");
    expect(btn.getAttribute("tabindex")).toBe("-1");
  });

  it("pluralizes the count", () => {
    render(<ApprovalPeekBar visible count={3} onClick={() => {}} />);
    expect(screen.getByText("3 approvals needed")).toBeTruthy();
  });

  it("invokes onClick (jump-to-latest) when pressed", () => {
    const onClick = vi.fn();
    render(<ApprovalPeekBar visible count={1} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
