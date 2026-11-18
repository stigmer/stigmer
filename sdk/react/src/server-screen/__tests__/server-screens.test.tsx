/**
 * Pins the desktop app's server screens, which render before any
 * `StigmerProvider`: connecting, then why a server can't be used (nothing
 * answered, with Try again; not a Stigmer server, with nothing to retry; not
 * set up for the app, as a plain note with its operator's guide), each with
 * Use another server; and the chooser, as a screen (the refusal under the
 * field, no Back when there is nothing to go back to) and as a dialog over
 * the app that holds the keyboard's focus: the kit's modal shell opens it
 * with `showModal()`, the browser's own focus trap (happy-dom has no top
 * layer, so the call is what this file can pin).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerConnectionView } from "../ServerConnectionView";
import { ServerChooserForm } from "../ServerChooserForm";

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true;
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

describe("ServerConnectionView", () => {
  it("says it is connecting to the server", () => {
    render(<ServerConnectionView state={{ status: "connecting" }} host="stigmer.acme.example" onRetry={() => {}} onChooseAnother={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Connecting to stigmer.acme.example…");
  });

  it("says nothing answered, tries again and offers another server", () => {
    const onRetry = vi.fn();
    const onChooseAnother = vi.fn();
    render(<ServerConnectionView state={{ status: "unreachable" }} host="stigmer.acme.example" onRetry={onRetry} onChooseAnother={onChooseAnother} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer Desktop can't reach stigmer.acme.example.");
    expect(alert.textContent).toContain("Check the address and your network, then try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Use another server" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
  });

  it("says a server that isn't Stigmer's, with nothing to try again", () => {
    render(<ServerConnectionView state={{ status: "not-stigmer" }} host="example.com" onRetry={() => {}} onChooseAnother={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("example.com doesn't look like a Stigmer server.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says a server not set up for the app plainly, with its operator's guide", () => {
    const onOpenGuide = vi.fn();
    render(
      <ServerConnectionView
        state={{ status: "not-set-up", serverName: "Acme" }}
        host="stigmer.acme.example"
        onRetry={() => {}}
        onChooseAnother={() => {}}
        onOpenGuide={onOpenGuide}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Acme isn't set up for Stigmer Desktop yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /How an operator sets it up/ }));
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });
});

describe("ServerChooserForm", () => {
  it("chooses the typed address, and says the host's refusal under the field", async () => {
    const onChoose = vi.fn(async () => "Use an https address, or http only on this computer.");
    render(<ServerChooserForm onChoose={onChoose} onBack={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Use another server" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Server address"), "http://stigmer.globex.example");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onChoose).toHaveBeenCalledWith("http://stigmer.globex.example");
    expect(await screen.findByText("Use an https address, or http only on this computer.")).toBeTruthy();
    expect(screen.getByLabelText("Server address").getAttribute("aria-invalid")).toBe("true");
  });

  it("offers no Back when there is nothing to go back to, and says why the server can't be used", () => {
    render(<ServerChooserForm onChoose={async () => null} unusable={{ host: "stigmer.acme.example", detail: "relative URL without a base" }} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("stigmer.acme.example can't be used.");
  });

  it("opens as a modal dialog over the app, which holds the keyboard's focus, and goes back on Back", async () => {
    const onBack = vi.fn();
    render(<ServerChooserForm presentation="dialog" open onChoose={async () => null} onBack={onBack} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(showModal).toHaveBeenCalled();
    expect(dialog.textContent).toContain("Use another server");
    await userEvent.click(screen.getByRole("button", { name: "Back", hidden: true }));
    expect(onBack).toHaveBeenCalled();
  });
});
