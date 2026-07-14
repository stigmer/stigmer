import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "../Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create share</Button>);

    const el = screen.getByRole("button", { name: "Create share" });
    expect(el.tagName).toBe("BUTTON");
    el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults type to button so it never submits an enclosing form", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("allows an explicit type override", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("applies the variant's token classes", () => {
    const { rerender } = render(<Button>CTA</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("bg-primary");

    rerender(<Button variant="outline">CTA</Button>);
    expect(el.className).toContain("border-border");
    expect(el.className).not.toContain("bg-primary");

    rerender(<Button variant="ghost">CTA</Button>);
    expect(el.className).toContain("hover:bg-accent-hover");

    rerender(<Button variant="destructive">CTA</Button>);
    expect(el.className).toContain("bg-destructive");
  });

  it("applies the size classes", () => {
    const { rerender } = render(<Button size="xs">CTA</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("px-2.5");

    rerender(<Button size="sm">CTA</Button>);
    expect(el.className).toContain("px-3");
  });

  it("renders a leading icon before the label", () => {
    render(
      <Button icon={<svg data-testid="icon" aria-hidden="true" />}>
        Create instance
      </Button>,
    );

    const el = screen.getByRole("button", { name: "Create instance" });
    expect(el.firstElementChild).toBe(screen.getByTestId("icon"));
  });

  it("passes native attributes through (disabled, aria-label)", () => {
    const onClick = vi.fn();
    render(
      <Button disabled aria-label="Reset link" onClick={onClick}>
        Reset
      </Button>,
    );

    const el = screen.getByRole("button", { name: "Reset link" });
    expect(el.hasAttribute("disabled")).toBe(true);
    el.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges caller classes after the variant classes", () => {
    render(<Button className="mt-2">CTA</Button>);
    expect(screen.getByRole("button").className).toContain("mt-2");
  });
});
