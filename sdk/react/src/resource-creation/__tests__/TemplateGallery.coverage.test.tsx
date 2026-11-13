/**
 * TemplateGallery's zero-results state: a search that matches nothing names
 * the search, and its "Clear search" act empties the search and the chosen
 * category so every template comes back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TemplateGallery } from "../TemplateGallery";
import type { ResourceTemplate } from "../templates/types";

interface Draft {
  readonly name: string;
}

const TEMPLATES: ResourceTemplate<Draft>[] = [
  {
    id: "t-analyst",
    name: "Sales analyst",
    description: "Summarizes the weekly pipeline",
    category: "data-analysis",
    data: { name: "analyst" },
  },
  {
    id: "t-deployer",
    name: "Release captain",
    description: "Ships the weekly release",
    category: "devops",
    data: { name: "deployer" },
  },
];

afterEach(cleanup);

describe("TemplateGallery", () => {
  it("names a search that matches nothing, and Clear search brings every template back", () => {
    render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "DevOps" }));
    const search = screen.getByRole("searchbox", { name: "Search templates" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zebra" } });

    expect(screen.getByText("Nothing matches “zebra”")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Templates" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(search.value).toBe("");
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Sales analyst")).toBeTruthy();
    expect(screen.getByText("Release captain")).toBeTruthy();
    expect(screen.queryByText("Nothing matches “zebra”")).toBeNull();
  });

  it("shows the host's empty content in place of the built-in state", () => {
    render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} emptyContent={<p>Ask an admin for templates</p>} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search templates" }), { target: { value: "zebra" } });

    expect(screen.getByText("Ask an admin for templates")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
