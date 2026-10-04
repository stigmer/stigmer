import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AgentVersionNotice } from "../AgentVersionNotice";

// ---------------------------------------------------------------------------
// The notice's words and its one control: it names the agent, and Update is
// the only thing that moves the conversation (disabled while it runs, with
// the failure shown beside it).
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("AgentVersionNotice", () => {
  it("names the agent and moves the conversation only when Update is pressed", () => {
    const onUpdate = vi.fn();
    render(<AgentVersionNotice agentName="PR Reviewer" onUpdate={onUpdate} />);

    expect(
      screen.getByText("This conversation runs an older version of PR Reviewer."),
    ).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("disables the control while updating and shows a failure", () => {
    render(
      <AgentVersionNotice
        agentName="PR Reviewer"
        onUpdate={vi.fn()}
        isUpdating
        error={new Error("You no longer have access to this agent.")}
      />,
    );

    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("no longer have access");
  });
});
