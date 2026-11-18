// ---------------------------------------------------------------------------
// The chooser over the running app goes back to the app on Back
//
// ChooseServerDialog is the chooser opened from "Change server": the kit's
// modal dialog, open while the server context says the person is choosing.
// The server context is the test's. Pinned: it opens while choosing, and
// Back stops choosing, leaving the app as it was.
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const server = vi.hoisted(() => ({ choose: vi.fn(async () => null), setChoosing: vi.fn() }));
vi.mock("../ServerProvider", () => ({
  useServer: () => ({ choose: server.choose, isChoosing: true, setChoosing: server.setChoosing }),
}));

import { ChooseServerDialog } from "../ConnectScreen";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(cleanup);

describe("the chooser over the app", () => {
  it("opens while choosing and stops choosing on Back", () => {
    render(<ChooseServerDialog />);
    expect(screen.getByRole("dialog", { hidden: true }).textContent).toContain("Use another server");

    fireEvent.click(screen.getByRole("button", { name: "Back", hidden: true }));
    expect(server.setChoosing).toHaveBeenCalledWith(false);
  });
});
