/**
 * The dialog's parts: DialogHeader names and describes its shell through the
 * shell's own ids (no id wired by hand), a caller's own title id still names
 * it, the close button asks the shell to close or runs the caller's close and
 * keeps the name its readers know, and the body and footer carry the parts in
 * the order a dialog reads (the acts last, at the end).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../DialogShell";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

describe("DialogHeader", () => {
  it("names the shell by its title and describes it by its line", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Run daily-report now?" description="Its schedule doesn't change." />
      </DialogShell>,
    );
    const dialog = container.querySelector("dialog")!;
    const title = screen.getByRole("heading", { level: 2, name: "Run daily-report now?" });
    const line = screen.getByText("Its schedule doesn't change.");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(line.id);
    expect(title.id).not.toBe("");
  });

  it("leaves the shell undescribed when the header has no line", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Sources" />
      </DialogShell>,
    );
    expect(container.querySelector("dialog")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("keeps a caller's own title id, which the caller's aria-labelledby names", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}} aria-labelledby="own-title">
        <DialogHeader id="own-title" title="Manage access" />
      </DialogShell>,
    );
    expect(container.querySelector("dialog")!.getAttribute("aria-labelledby")).toBe("own-title");
    expect(screen.getByRole("heading", { name: "Manage access" }).id).toBe("own-title");
  });

  it("lets an aria-label name the shell instead of the title", () => {
    const { container } = render(
      <DialogShell open onOpenChange={() => {}} aria-label="Image preview">
        <DialogHeader title="photo.png" />
      </DialogShell>,
    );
    const dialog = container.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-label")).toBe("Image preview");
    expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("asks the shell to close from its close button", () => {
    const onOpenChange = vi.fn();
    render(
      <DialogShell open onOpenChange={onOpenChange}>
        <DialogHeader title="Sources" />
      </DialogShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs the caller's close, under the name its readers know, and holds it while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Sessions" closeLabel="Close sessions" onClose={onClose} />
      </DialogShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close sessions" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Sessions" closeLabel="Close sessions" onClose={onClose} closeDisabled />
      </DialogShell>,
    );
    expect((screen.getByRole("button", { name: "Close sessions" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws no close button when the dialog must be answered by its acts", () => {
    render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Delete it?" hideClose />
      </DialogShell>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("draws a mark before the title and the caller's acts before the close button", () => {
    render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Connect to Slack" icon={<span>mark</span>} actions={<button type="button">Help</button>} />
      </DialogShell>,
    );
    const order = [...document.querySelectorAll("span, h2, button")].map((el) => el.textContent || el.getAttribute("aria-label"));
    expect(order.indexOf("mark")).toBeLessThan(order.indexOf("Connect to Slack"));
    expect(order.indexOf("Help")).toBeLessThan(order.indexOf("Close"));
  });
});

describe("DialogBody and DialogFooter", () => {
  it("lays the body above the acts, the acts at the dialog's end, Cancel first", () => {
    render(
      <DialogShell open onOpenChange={() => {}}>
        <DialogHeader title="Run it now?" />
        <DialogBody>
          <p>One run starts now.</p>
        </DialogBody>
        <DialogFooter leading={<span>Validating…</span>}>
          <button type="button">Cancel</button>
          <button type="button">Run now</button>
        </DialogFooter>
      </DialogShell>,
    );
    const footer = screen.getByRole("button", { name: "Run now" }).parentElement!;
    expect(footer.className).toContain("stg:justify-end");
    const names = [...footer.children].map((child) => child.textContent);
    expect(names).toEqual(["Validating…", "Cancel", "Run now"]);
    expect(screen.getByText("One run starts now.").parentElement!.className).toContain("stg:px-6");
  });
});
