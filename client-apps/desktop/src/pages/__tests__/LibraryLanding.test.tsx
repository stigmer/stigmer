/**
 * Pins the desktop Library landing as a thin shell over the kit's overview
 * (its cards, Add menu and Apply YAML are pinned beside the overview in
 * @stigmer/react-sdk): a card or an Add menu item goes to its address
 * through the router, and a card's address is the hash route, so a
 * modified click lands where a plain one does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

type Props = Record<string, unknown>;

const page = vi.hoisted(() => ({ props: new Map<string, Props>() }));

vi.mock("@stigmer/react-sdk/console", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-sdk/console")>()),
  LibraryOverview: (props: Props) => {
    page.props.set("LibraryOverview", props);
    return null;
  },
}));

import LibraryLanding from "../library/LibraryLanding";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/library"]}>
      <Routes>
        <Route path="*" element={<LibraryLanding />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function overview(): Props {
  const props = page.props.get("LibraryOverview");
  if (!props) throw new Error("the overview was not rendered");
  return props;
}

beforeEach(() => {
  page.props.clear();
});

describe("desktop LibraryLanding", () => {
  it("opens each kind's list from its card", () => {
    renderLanding();
    const onNavigate = overview().onNavigate as (path: string) => void;

    act(() => onNavigate("/library/plugins"));
    expect(screen.getByTestId("location").textContent).toBe("/library/plugins");
    act(() => onNavigate("/library/routines/new"));
    expect(screen.getByTestId("location").textContent).toBe("/library/routines/new");
  });

  it("writes a card's address as the hash route", () => {
    renderLanding();

    expect((overview().toHref as (path: string) => string)("/library/files")).toBe("#/library/files");
  });
});
