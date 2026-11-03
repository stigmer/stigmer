// ---------------------------------------------------------------------------
// The desktop's user menu: the kit's menu, extended through its seam
//
// "Change server…" sits in the kit's `extraItems`, names the server the app
// talks to, and opens the server form. The kit's menu and its item are
// stubbed to what the desktop hands them; the kit pins its own menu.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@stigmer/react-sdk/console", () => ({
  UserMenu: ({ extraItems }: { extraItems?: ReactNode }) => <div>{extraItems}</div>,
}));
vi.mock("@stigmer/react-sdk", () => ({
  ActionMenu: {
    Item: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
      <button onClick={onSelect}>{children}</button>
    ),
  },
}));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ user: null, logout: () => {} }) }));
vi.mock("../../hooks/useColorModePreference", () => ({
  useColorModePreference: () => ({ colorMode: "system", setColorMode: () => {} }),
}));
const server = vi.hoisted(() => ({ label: "stigmer.acme.internal", setChoosing: vi.fn() }));
vi.mock("../../server/ServerProvider", () => ({ useServer: () => server }));

import { UserMenu } from "../UserMenu";

describe("the desktop's user menu", () => {
  it("offers Change server, naming the server the app talks to, and opens the server form", async () => {
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );

    const item = screen.getByRole("button", { name: /Change server/ });
    expect(item.textContent).toContain("stigmer.acme.internal");
    await userEvent.click(item);
    expect(server.setChoosing).toHaveBeenCalledWith(true);
  });
});
