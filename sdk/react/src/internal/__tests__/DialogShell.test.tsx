/**
 * DialogShell (stigmer#653): the one modal shell — showModal lifecycle,
 * cancel/Escape wiring with state authority, native-close sync, the token
 * backdrop + converged chrome, the non-modal in-flow mode, and the portal
 * target a modal shell provides to the popups inside it (stigmer#1509).
 * happy-dom has no top layer, so this file pins the contract only; the
 * popups themselves are proven in a real browser by
 * `dialog-popups.layout.browser.test.tsx`.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { createPortal } from "react-dom";
import { DialogShell } from "../DialogShell";
import {
  PortalContainerContext,
  useStigmerPortalContainer,
} from "../../portal-container";

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

function dialogOf(container: HTMLElement): HTMLDialogElement {
  return container.querySelector("dialog")!;
}

describe("DialogShell lifecycle", () => {
  it("opens via showModal when the controlled prop flips true", () => {
    const { container, rerender } = render(
      <DialogShell open={false} onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).open).toBe(false);

    rerender(
      <DialogShell open onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).open).toBe(true);
  });

  it("shows immediately when mounted already open", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).open).toBe(true);
  });

  it("closes the native dialog when the controlled prop flips false", () => {
    const { container, rerender } = render(
      <DialogShell open onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    rerender(
      <DialogShell open={false} onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).open).toBe(false);
  });

  it("Escape/cancel reports intent but never closes on its own — state stays authoritative", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );

    fireEvent(dialogOf(container), new Event("cancel", { cancelable: true }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    // The shell prevented the native close; the dialog stays open until the
    // host flips the prop.
    expect(dialogOf(container).open).toBe(true);
  });

  it("syncs the controlled state when something else closes the dialog natively", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );

    // e.g. a method="dialog" form submit closes without going through props.
    const dialog = dialogOf(container);
    dialog.close();
    fireEvent(dialog, new Event("close"));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("does not re-report a close the host itself drove", () => {
    const onOpenChange = vi.fn();
    const { container, rerender } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );
    rerender(
      <DialogShell open={false} onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );
    // The effect's own dialog.close() fires a native close event in real
    // browsers — replay it against the now-false prop.
    fireEvent(dialogOf(container), new Event("close"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("DialogShell chrome", () => {
  it("carries the token backdrop, animation, positioning, and width preset", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}} width="3xl">
        <p>body</p>
      </DialogShell>,
    );
    const cls = dialogOf(container).className;

    expect(cls).toContain("stg:backdrop:bg-backdrop");
    expect(cls).toContain("stg:open:animate-in");
    expect(cls).toContain("stg:fixed");
    expect(cls).toContain("stg:m-auto");
    expect(cls).toContain("stg:max-w-3xl");
    expect(cls).toContain("stg:bg-popover");
  });

  it("className overrides the shell's own chrome per class (tailwind-merge)", () => {
    const { container } = render(
      <DialogShell
        open
        onOpenChange={() => {}}
        className="stg:bg-background stg:max-w-[85vw]"
      >
        <p>body</p>
      </DialogShell>,
    );
    const cls = dialogOf(container).className;

    expect(cls).toContain("stg:bg-background");
    expect(cls).not.toContain("stg:bg-popover");
    expect(cls).toContain("stg:max-w-[85vw]");
    expect(cls).not.toContain("stg:max-w-md");
  });

  it("labels the dialog for assistive tech", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}} aria-label="Confirm delete">
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).getAttribute("aria-label")).toBe("Confirm delete");
  });
});

describe("DialogShell backdrop dismiss", () => {
  it("dismissOnBackdrop: a click on the dialog element itself reports close intent", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <DialogShell open onOpenChange={onOpenChange} dismissOnBackdrop>
        <p>body</p>
      </DialogShell>,
    );

    fireEvent.click(dialogOf(container));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("dismissOnBackdrop: clicks on content descendants never dismiss", () => {
    const onOpenChange = vi.fn();
    const { container, getByText } = render(
      <DialogShell open onOpenChange={onOpenChange} dismissOnBackdrop>
        <p>body</p>
      </DialogShell>,
    );

    fireEvent.click(getByText("body"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogOf(container).open).toBe(true);
  });

  it("default: backdrop clicks are inert (form dialogs)", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );

    fireEvent.click(dialogOf(container));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("DialogShell non-modal mode", () => {
  it("renders in-flow: open attribute, no backdrop, no fixed positioning", () => {
    const { container, rerender } = render(
      <DialogShell open modal={false} onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    const dialog = dialogOf(container);

    expect(dialog.open).toBe(true);
    expect(dialog.className).toContain("stg:relative");
    expect(dialog.className).not.toContain("stg:backdrop:bg-backdrop");
    expect(dialog.className).not.toContain("stg:fixed");

    rerender(
      <DialogShell open={false} modal={false} onOpenChange={() => {}}>
        <p>body</p>
      </DialogShell>,
    );
    expect(dialogOf(container).open).toBe(false);
  });
});

/** Records the portal container the shell publishes to its children. */
function PortalProbe({
  onValue,
}: {
  readonly onValue: (value: HTMLElement | null | undefined) => void;
}) {
  onValue(useStigmerPortalContainer());
  return null;
}

/** Stands in for an open Base UI popup: content portaled into the target. */
function OpenPopup() {
  const container = useStigmerPortalContainer();
  return container ? createPortal(<div role="listbox" />, container) : null;
}

/** Waits for the task a keydown queues to clear the shell's Escape record. */
function nextTask(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe("DialogShell portal target (stigmer#1509)", () => {
  it("a modal shell publishes an unmarked element inside the dialog", () => {
    let published: HTMLElement | null | undefined;
    const { container } = render(
      <DialogShell open onOpenChange={() => {}}>
        <PortalProbe onValue={(value) => (published = value)} />
      </DialogShell>,
    );

    expect(published).toBeInstanceOf(HTMLElement);
    expect(dialogOf(container).contains(published!)).toBe(true);
    expect(published!.hasAttribute("data-stgm-portal")).toBe(false);
    // Fixed, so the dialog's scrolling box cannot clip what it holds
    // (proven in Chromium by dialog-popups.layout.browser.test.tsx).
    expect(published!.className).toContain("stg:fixed");
  });

  it("a non-modal shell passes the inherited container through", () => {
    const inherited = document.createElement("div");
    let published: HTMLElement | null | undefined;
    render(
      <PortalContainerContext.Provider value={inherited}>
        <DialogShell open modal={false} onOpenChange={() => {}}>
          <PortalProbe onValue={(value) => (published = value)} />
        </DialogShell>
      </PortalContainerContext.Provider>,
    );

    expect(published).toBe(inherited);
  });

  it("a popup portaled by a child lands inside the dialog", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}}>
        <OpenPopup />
      </DialogShell>,
    );

    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(dialogOf(container).contains(listbox)).toBe(true);
  });

  it("Escape while a popup is open keeps the dialog; the next Escape closes it", async () => {
    const onOpenChange = vi.fn();
    const { container, rerender } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <OpenPopup />
      </DialogShell>,
    );
    const dialog = dialogOf(container);

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onOpenChange).not.toHaveBeenCalled();

    // The popup has closed (Base UI unmounts it); the next Escape is the
    // dialog's.
    rerender(
      <DialogShell open onOpenChange={onOpenChange}>
        <p>body</p>
      </DialogShell>,
    );
    await nextTask();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("a popup Escape the browser sends no cancel for never swallows a later one", async () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <DialogShell open onOpenChange={onOpenChange}>
        <OpenPopup />
      </DialogShell>,
    );
    const dialog = dialogOf(container);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await nextTask();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});
