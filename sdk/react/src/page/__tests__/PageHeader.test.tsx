/**
 * Pins the console's one page heading: the title at the level the host's
 * outline needs (a document heading by default, the second level under a
 * layout that gives one), the id a landmark names itself by, one line of
 * purpose when given and none when not, and the page's acts beside the
 * title only when there are some.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHeader } from "../PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("draws the title as the document's heading, with its purpose", () => {
    render(<PageHeader title="Dashboard" description="What your organization's agents did this week." />);

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText("What your organization's agents did this week.")).toBeTruthy();
  });

  it("draws the title at the second level, with the id a landmark names itself by", () => {
    render(
      <section aria-labelledby="members-heading">
        <PageHeader title="Members" headingLevel={2} headingId="members-heading" />
      </section>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Members" }).id).toBe("members-heading");
    expect(screen.getByRole("region", { name: "Members" })).toBeTruthy();
  });

  it("draws the page's acts beside the title, and no acts' row when there are none", () => {
    const { container, rerender } = render(<PageHeader title="Marketplace" actions={<button type="button">Upload</button>} />);
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();

    rerender(<PageHeader title="Marketplace" actions={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelectorAll("header > div > div")).toHaveLength(0);
    expect(container.querySelector("header > p")).toBeNull();
  });
});
