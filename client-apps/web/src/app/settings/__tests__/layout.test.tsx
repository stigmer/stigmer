// ---------------------------------------------------------------------------
// The settings frame the web console draws around every settings page and
// the loading state it shows between them
//
// The layout gives the document its "Settings" heading for assistive
// technology (each page draws its own visible heading through the kit) and a
// column wide enough for a settings page's tables, the same frame as the
// desktop app's. While the next settings page loads, the route shows the
// kit's settings skeleton: one busy region, named, as every settings page
// draws while it reads.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsLayout from "../layout";
import SettingsLoading from "../loading";

describe("the settings layout", () => {
  it("heads the document Settings for assistive technology and holds the page in the wide column", () => {
    render(
      <SettingsLayout>
        <p>The page</p>
      </SettingsLayout>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(heading.className).toContain("sr-only");
    const column = screen.getByText("The page").parentElement as HTMLElement;
    expect(column.className).toContain("max-w-5xl");
    expect(column.contains(heading)).toBe(true);
  });
});

describe("the settings loading state", () => {
  it("draws the settings skeleton: one busy region named for what loads", () => {
    const { container } = render(<SettingsLoading />);
    expect(container.querySelectorAll("[aria-busy='true']")).toHaveLength(1);
    expect(screen.getByText("Loading settings")).toBeTruthy();
  });
});
