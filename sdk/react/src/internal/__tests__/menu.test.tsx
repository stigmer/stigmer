/**
 * The internal menu's labelled group: a MenuLabel inside a MenuGroup shows
 * its heading above the group's items in the open menu, so a person can
 * tell one section of a menu from the next (ActionMenu.Group and the user
 * menu's account header are built from it).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuTrigger } from "../menu";
import { openMenu } from "../../__tests__/helpers/open-menu";

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which Base UI positioners observe.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

describe("MenuLabel in a MenuGroup", () => {
  it("heads its group's items in the open menu", async () => {
    render(
      <Menu>
        <MenuTrigger>Agent actions</MenuTrigger>
        <MenuContent>
          <MenuItem>Rename</MenuItem>
          <MenuGroup aria-label="Danger zone">
            <MenuLabel>Danger zone</MenuLabel>
            <MenuItem>Delete</MenuItem>
          </MenuGroup>
        </MenuContent>
      </Menu>,
    );

    await openMenu(screen.getByRole("button", { name: "Agent actions" }));

    const group = screen.getByRole("group", { name: "Danger zone" });
    const label = within(group).getByText("Danger zone");
    const item = within(group).getByRole("menuitem", { name: "Delete" });
    expect(label.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });
});
