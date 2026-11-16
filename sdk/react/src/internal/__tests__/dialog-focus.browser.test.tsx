// A dialog drawn with its parts, in a real Chromium: opening moves focus into
// the dialog, closing returns it to what opened it, and the dialog is named
// and described by its header. happy-dom has no top layer and no native
// focus handling for <dialog>, so only a real browser can prove where focus
// goes.

import "../../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { useState } from "react";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../DialogShell";
import { ConfirmDialog } from "../../resource-detail/ConfirmDialog";

afterEach(cleanup);

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Run now
      </button>
      <DialogShell open={open} onOpenChange={setOpen}>
        <DialogHeader title="Run daily-report now?" description="Its schedule doesn't change." />
        <DialogBody>
          <label htmlFor="note">Note</label>
          <input id="note" />
        </DialogBody>
        <DialogFooter>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button">Start run</button>
        </DialogFooter>
      </DialogShell>
    </>
  );
}

describe("a dialog drawn with its parts", () => {
  it("takes focus when it opens and gives it back when it closes", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Run now" });
    await userEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Run daily-report now?" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape and gives focus back", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Run now" });
    await userEvent.click(opener);
    await screen.findByRole("dialog", { name: "Run daily-report now?" });

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("starts a confirm's focus on Cancel, so a key pressed on opening never confirms", async () => {
    render(
      <ConfirmDialog
        state={{ title: "Remove ledger-tools?", description: "Removes the plugin and its versions.", confirmLabel: "Remove", variant: "destructive", resolve: () => {} }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    await screen.findByRole("dialog", { name: "Remove ledger-tools?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });
});
