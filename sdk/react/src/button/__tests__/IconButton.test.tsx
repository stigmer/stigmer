// An icon alone is never a nameless button: its label is the accessible
// name and the tooltip, its size is a square of the button's height, and
// it acts and passes native attributes through like Button. The tooltip's
// reveal needs real pointer movement: IconButton.layout.browser.test.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TooltipProvider } from "../../internal/tooltip";
import { IconButton } from "../IconButton";

afterEach(cleanup);

const icon = <svg data-testid="icon" aria-hidden="true" />;

function renderIn(node: React.ReactElement) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

describe("IconButton", () => {
  it("is named by its label and fires onClick", () => {
    const onClick = vi.fn();
    renderIn(<IconButton label="Remove Grace Hopper" icon={icon} onClick={onClick} />);
    const el = screen.getByRole("button", { name: "Remove Grace Hopper" });
    expect(el.getAttribute("type")).toBe("button");
    expect(el.contains(screen.getByTestId("icon"))).toBe(true);
    el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a square of the size's height, ghost by default", () => {
    const { rerender } = renderIn(<IconButton label="Edit" icon={icon} />);
    const el = screen.getByRole("button", { name: "Edit" });
    expect(el.className).toContain("stg:size-8");
    expect(el.className).toContain("stg:text-muted-foreground");
    rerender(
      <TooltipProvider>
        <IconButton label="Edit" icon={icon} size="xs" variant="outline" />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("stg:size-7");
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("stg:border-border");
  });

  it("passes disabled through, and a disabled button does not act", () => {
    const onClick = vi.fn();
    renderIn(<IconButton label="Remove" icon={icon} disabled onClick={onClick} />);
    const el = screen.getByRole("button", { name: "Remove" });
    expect(el.hasAttribute("disabled")).toBe(true);
    el.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
