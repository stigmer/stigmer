// The kit's one action button: a native button that never submits a form
// unasked, every variant of a size one height (a set height and a border on
// every variant, so a filled and an outlined button line up), and native
// attributes passed through.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "../Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add channel</Button>);

    const el = screen.getByRole("button", { name: "Add channel" });
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
    expect(el.className).toContain("stg:bg-primary");

    rerender(<Button variant="outline">CTA</Button>);
    expect(el.className).toContain("stg:border-border");
    expect(el.className).not.toContain("stg:bg-primary");

    rerender(<Button variant="ghost">CTA</Button>);
    expect(el.className).toContain("stg:hover:bg-accent-hover");

    rerender(<Button variant="destructive">CTA</Button>);
    expect(el.className).toContain("stg:bg-destructive");
  });

  it("sets each size's height and type, not padding alone: 32px at 14px, 28px at 12px", () => {
    const { rerender } = render(<Button size="xs">CTA</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("stg:h-7");
    expect(el.className).toContain("stg:text-xs");

    rerender(<Button size="sm">CTA</Button>);
    expect(el.className).toContain("stg:h-8");
    expect(el.className).toContain("stg:text-sm");
    expect(el.className).not.toContain("stg:py-");
  });

  it("draws every variant with a border and the same height, so a filled and an outlined button line up", () => {
    for (const size of ["sm", "xs"] as const) {
      const heights = new Set<string>();
      for (const variant of ["primary", "outline", "ghost", "destructive"] as const) {
        const { unmount } = render(<Button variant={variant} size={size}>CTA</Button>);
        const classes = screen.getByRole("button").className.split(/\s+/);
        expect(classes).toContain("stg:border");
        heights.add(classes.filter((c) => /^stg:h-\d/.test(c)).join(" "));
        unmount();
      }
      expect([...heights]).toHaveLength(1);
    }
  });

  it("forwards its ref to the native button", () => {
    let node: HTMLButtonElement | null = null;
    render(<Button ref={(el) => { node = el; }}>CTA</Button>);
    expect(node).toBe(screen.getByRole("button"));
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
    render(<Button className="stg:mt-2">CTA</Button>);
    expect(screen.getByRole("button").className).toContain("stg:mt-2");
  });
});
