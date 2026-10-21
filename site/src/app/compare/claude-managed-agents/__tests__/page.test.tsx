/**
 * The `/compare/claude-managed-agents` route: its metadata for search and
 * link previews, and a page that renders the comparison.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Page, { metadata } from "../page";

afterEach(cleanup);

describe("/compare/claude-managed-agents route", () => {
  it("names both products in its title and describes what it compares", () => {
    expect(metadata.title).toBe("Stigmer and Claude Managed Agents");
    expect(metadata.description).toMatch(/^How Stigmer and Claude Managed Agents compare:/);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("renders the comparison", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Stigmer and Claude Managed Agents",
    );
  });
});
