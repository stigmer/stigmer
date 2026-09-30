// Popups opened inside an SDK modal dialog, in a real Chromium
// (stigmer#1509). A modal `DialogShell` is a native `<dialog>` in the
// browser's top layer, which paints above everything else and makes the
// rest of the document inert. A popup portaled to the provider's
// `document.body` container from inside it is drawn beneath the dialog and
// refuses every click — the Manage access visibility list could not be
// used in any edition. happy-dom has no top layer (and the default suite
// stubs `showModal`), so only a real browser can prove where a popup lands
// and whether it takes the pointer, focus and keys. This suite drives the
// shell with the SDK's real popups: the visibility selector, the house
// menu and tooltip, and a Base UI popover taller than the room below its
// trigger.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import type { Stigmer } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerProvider } from "../../provider";
import { useStigmerPortalContainer } from "../../portal-container";
import { VisibilitySelector } from "../../library/VisibilitySelector";
import { blueprintVisibilityLevels } from "../../library/visibilityLevels";
import { DialogShell } from "../DialogShell";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "../menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "../tooltip";

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-stgm-portal]").forEach((node) => node.remove());
});

// A minimal client: the provider fetches registries on mount; a null
// credential keeps that off the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function renderInDialog(
  body: ReactNode,
  onOpenChange: (open: boolean) => void = () => {},
): HTMLDialogElement {
  render(
    <StigmerProvider client={makeClient()}>
      <DialogShell open onOpenChange={onOpenChange} aria-label="Popup host">
        <div className="stg:p-6">{body}</div>
      </DialogShell>
    </StigmerProvider>,
  );
  return screen.getByRole("dialog", { name: "Popup host" }) as HTMLDialogElement;
}

/**
 * True when a real pointer at the element's centre would reach it: the
 * top layer covers anything beneath the dialog, so `elementFromPoint`
 * answers with the dialog's own content instead.
 */
function receivesPointer(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  return hit !== null && element.contains(hit);
}

function withinViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth
  );
}

function VisibilityControl({
  onVisibilityChange,
}: {
  readonly onVisibilityChange: (value: ApiResourceVisibility) => void;
}) {
  return (
    <VisibilitySelector
      visibility={ApiResourceVisibility.visibility_org}
      options={blueprintVisibilityLevels({ hasIdentityProvider: false })}
      onVisibilityChange={onVisibilityChange}
    />
  );
}

/** A Base UI popover wired the way every SDK popup is (portal-container.ts). */
function TallPopover() {
  const portalContainer = useStigmerPortalContainer();
  return (
    <Popover.Root>
      <Popover.Trigger>Open tall popover</Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup aria-label="Tall popover" className="stg:bg-popover">
            <div style={{ height: 320, width: 200 }} />
            <button type="button">Last row</button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

describe("popups inside a modal DialogShell (stigmer#1509)", () => {
  it("the visibility list opens above the dialog, takes focus and the pointer, and writes the choice", async () => {
    const onVisibilityChange = vi.fn();
    const dialog = renderInDialog(
      <VisibilityControl onVisibilityChange={onVisibilityChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Organization/ }));
    const listbox = await screen.findByRole("listbox", {
      name: "Resource visibility",
    });

    expect(dialog.contains(listbox)).toBe(true);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Private"),
      expect.stringContaining("Organization"),
    ]);
    for (const option of options) {
      expect(receivesPointer(option), `${option.textContent} takes the pointer`).toBe(true);
    }
    // The selector focuses the current level on open, which an inert popup
    // silently refuses.
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(options[1]);
    });

    await userEvent.click(options[0]!);
    expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("the house menu and tooltip inside the dialog reveal and take the pointer", async () => {
    const onRename = vi.fn();
    const dialog = renderInDialog(
      <div className="stg:flex stg:gap-4">
        <Menu>
          <MenuTrigger>Actions</MenuTrigger>
          <MenuContent>
            <MenuItem onClick={onRename}>Rename</MenuItem>
          </MenuContent>
        </Menu>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>What this does</TooltipContent>
        </Tooltip>
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const item = await screen.findByRole("menuitem", { name: "Rename" });
    expect(dialog.contains(item)).toBe(true);
    expect(receivesPointer(item)).toBe(true);
    await userEvent.click(item);
    expect(onRename).toHaveBeenCalledOnce();

    await userEvent.hover(screen.getByRole("button", { name: "Info" }));
    const hint = await screen.findByText("What this does", undefined, {
      timeout: 3000,
    });
    expect(dialog.contains(hint)).toBe(true);
    expect(receivesPointer(hint)).toBe(true);
  });

  it("a popup taller than the room below its trigger stays whole and reachable", async () => {
    const dialog = renderInDialog(<TallPopover />);

    await userEvent.click(screen.getByRole("button", { name: "Open tall popover" }));
    const popup = await screen.findByRole("dialog", { name: "Tall popover" });
    const lastRow = screen.getByRole("button", { name: "Last row" });

    expect(dialog.contains(popup)).toBe(true);
    expect(withinViewport(popup), "the popup is not cut off by the viewport").toBe(true);
    expect(receivesPointer(lastRow), "the popup's far edge is not clipped by the dialog").toBe(
      true,
    );
  });

  it("Escape closes the open list and keeps the dialog; the next Escape closes the dialog", async () => {
    const onOpenChange = vi.fn();
    renderInDialog(<VisibilityControl onVisibilityChange={() => {}} />, onOpenChange);

    await userEvent.click(screen.getByRole("button", { name: /Organization/ }));
    await screen.findByRole("listbox", { name: "Resource visibility" });

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });
  });
});
