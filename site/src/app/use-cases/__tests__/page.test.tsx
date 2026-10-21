/**
 * The `/use-cases` route: its metadata for search and link previews, and a
 * page that renders the jobs.
 *
 * Pins that the description offers jobs inside a product as examples, not
 * as deployments, and not the industries the page once listed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Page, { metadata } from "../page";

afterEach(cleanup);

describe("/use-cases route", () => {
  it("describes jobs inside a product, as examples", () => {
    expect(metadata.title).toBe("Use Cases");
    expect(metadata.description).toMatch(/^Examples of jobs Stigmer's agents can do inside a product/);
    expect(JSON.stringify(metadata)).not.toMatch(/healthcare|fintech/i);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("renders the jobs", () => {
    const { container } = render(<Page />);

    expect(container.querySelector("article#accounting")).not.toBeNull();
  });
});
