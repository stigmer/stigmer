/**
 * Pins the sidebar foot's status row: the state said as a live status, its
 * dot in the status hues (pending before anything runs, ready while it runs,
 * failed when it stopped), the reason under it, and its one act.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarStatusRow } from "../SidebarStatusRow";

afterEach(cleanup);

function dotOf(): string {
  return screen.getByRole("status").parentElement?.querySelector("[aria-hidden='true']")?.getAttribute("class") ?? "";
}

describe("SidebarStatusRow", () => {
  it("says the state as a live status, its dot in the pending hue before anything runs", () => {
    render(<SidebarStatusRow tone="quiet" label="Agents start with a conversation" />);
    expect(screen.getByRole("status").textContent).toBe("Agents start with a conversation");
    expect(dotOf()).toContain("stg:bg-status-pending");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws a running state's dot in the ready hue", () => {
    render(<SidebarStatusRow tone="live" label="Agents ready" />);
    expect(dotOf()).toContain("stg:bg-status-ready");
  });

  it("says why it stopped, in the failed hue, with its one act", () => {
    const onClick = vi.fn();
    render(
      <SidebarStatusRow
        tone="alert"
        label="Agents couldn't start"
        detail="The agents' process exited: port 7466 is in use by another app."
        action={{ label: "Try again", onClick }}
      />,
    );
    expect(dotOf()).toContain("stg:bg-status-failed");
    expect(screen.getByText("The agents' process exited: port 7466 is in use by another app.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
