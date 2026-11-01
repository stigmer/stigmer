/**
 * The desktop settings frame: the document's "Settings" heading for
 * assistive technology (each page draws its own visible heading through the
 * kit), and the matched settings page inside a column wide enough for a
 * settings page's tables, the same frame as the web console's.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsLayout from "../settings/SettingsLayout";

describe("SettingsLayout", () => {
  it("heads the document Settings for assistive technology and holds the matched page in the wide column", () => {
    render(
      <MemoryRouter initialEntries={["/settings/members"]}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="members" element={<p>The members page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Settings" }).className).toContain("sr-only");
    const column = screen.getByText("The members page").parentElement as HTMLElement;
    expect(column.className).toContain("max-w-5xl");
  });
});
