/**
 * Pins CreationPicker's template entry point: with templates to offer, the
 * "Browse templates" card carries a badge saying how many there are, and
 * choosing it swaps the options for the gallery. With none, the card is not
 * offered at all, so nobody opens an empty gallery.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreationPicker } from "../CreationPicker";
import type { ResourceTemplate } from "../templates/types";

interface Draft {
  readonly name: string;
}

const TEMPLATES: readonly ResourceTemplate<Draft>[] = [
  { id: "t-review", name: "Code reviewer", description: "Reviews pull requests", category: "devops", data: { name: "reviewer" } },
  { id: "t-writer", name: "Blog writer", description: "Drafts posts", category: "content", data: { name: "writer" } },
];

afterEach(cleanup);

describe("CreationPicker template card", () => {
  it("badges the template card with how many templates are available and opens the gallery", () => {
    const onSelect = vi.fn();
    render(<CreationPicker resourceLabel="agent" templates={TEMPLATES} onSelect={onSelect} />);

    const card = screen.getByRole("button", { name: /Browse templates/ });
    expect(card.textContent).toContain("2 available");

    fireEvent.click(card);
    expect(screen.getByRole("heading", { name: "Choose a template" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers no template card when there are no templates", () => {
    render(<CreationPicker resourceLabel="agent" templates={[]} onSelect={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Browse templates/ })).toBeNull();
    expect(screen.queryByText(/available/)).toBeNull();
  });
});
