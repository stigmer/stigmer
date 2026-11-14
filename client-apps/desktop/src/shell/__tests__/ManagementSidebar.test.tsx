/**
 * Pins what the desktop app's settings sidebar hands the SDK's
 * SettingsSidebar for its foot: the server's help row (CON-13), then the
 * user menu. The chrome itself is the SDK's and is held there.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@stigmer/react-sdk/console", () => ({
  SettingsSidebar: ({ footer }: { footer: ReactNode }) => <>{footer}</>,
  useSettingsNavGroups: () => [],
  HelpLink: ({ variant }: { variant?: string }) => <p>help link ({variant})</p>,
}));
vi.mock("../UserMenu", () => ({ UserMenu: () => <p>user menu</p> }));
vi.mock("../use-layout-state", () => ({
  useSidebarOpen: () => ({ isOpen: true, close: () => undefined }),
}));

import { ManagementSidebar } from "../ManagementSidebar";

describe("desktop ManagementSidebar — the foot", () => {
  it("CON-13 puts the server's help row above the user menu", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <ManagementSidebar />
      </MemoryRouter>,
    );
    const lines = screen.getAllByText(/help link|user menu/).map((node) => node.textContent);
    expect(lines).toEqual(["help link (row)", "user menu"]);
  });
});
