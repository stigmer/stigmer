/**
 * Pins what a TemplateCard shows and does: the template's name, its category
 * under the category's human label, and its description, that a click or
 * the Enter key hands the template to onSelect, and that its initial and
 * category pill draw on theme tokens, the same for every template, as a
 * resource card's do (stigmer#2763).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TemplateCard } from "../TemplateCard";
import type { ResourceTemplate } from "../templates/types";

interface Draft {
  readonly name: string;
}

const TEMPLATE: ResourceTemplate<Draft> = {
  id: "t-analyst",
  name: "Sales analyst",
  description: "Summarizes the weekly pipeline",
  category: "data-analysis",
  data: { name: "analyst" },
};

afterEach(cleanup);

describe("TemplateCard", () => {
  it("shows the name, the category's label and the description", () => {
    render(<TemplateCard template={TEMPLATE} onSelect={vi.fn()} />);

    const card = screen.getByRole("button", { name: "Use Sales analyst template" });
    expect(card.textContent).toContain("Sales analyst");
    expect(screen.getByText("Data Analysis")).toBeTruthy();
    expect(screen.getByText("Summarizes the weekly pipeline")).toBeTruthy();
  });

  it("hands the template to onSelect on a click and on Enter", () => {
    const onSelect = vi.fn();
    render(<TemplateCard template={TEMPLATE} onSelect={onSelect} />);

    const card = screen.getByRole("button", { name: "Use Sales analyst template" });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, TEMPLATE);
    expect(onSelect).toHaveBeenNthCalledWith(2, TEMPLATE);
  });

  it("draws the initial on the theme's avatar colour, the same for every template", () => {
    const other: ResourceTemplate<Draft> = {
      ...TEMPLATE,
      id: "t-deployer",
      name: "Release deployer",
      category: "devops",
    };
    render(
      <>
        <TemplateCard template={TEMPLATE} onSelect={vi.fn()} />
        <TemplateCard template={other} onSelect={vi.fn()} />
      </>,
    );

    const first = screen.getByText("S");
    const second = screen.getByText("R");
    expect(first.className).toContain("stg:bg-avatar");
    expect(first.className).toContain("stg:text-muted-foreground");
    expect(second.className).toBe(first.className);
    expect(screen.getByText("DevOps").className).toBe(screen.getByText("Data Analysis").className);
  });
});
