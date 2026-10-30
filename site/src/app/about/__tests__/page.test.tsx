/**
 * The `/about` route: its metadata for search and link previews, and a page
 * that renders why Stigmer was built.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Page, { metadata } from "../page";

afterEach(cleanup);

describe("/about route", () => {
  it("is titled by its question and says where Stigmer started", () => {
    expect(metadata.title).toBe("Why we built Stigmer");
    expect(metadata.description).toMatch(/^Stigmer started inside Planton,/);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("renders the page", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Why we built Stigmer");
  });
});
