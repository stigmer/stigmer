/**
 * DialogShell (stigmer#653): the one modal shell — showModal lifecycle,
 * cancel/Escape wiring with state authority, native-close sync, the token
 * backdrop + converged chrome, and the non-modal in-flow mode.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { DialogShell } from "../DialogShell";

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
