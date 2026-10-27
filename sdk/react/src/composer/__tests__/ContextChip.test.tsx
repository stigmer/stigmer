/**
 * ContextChip, the pill the composer shows for each thing a conversation
 * carries (an agent, a workspace, an MCP server, a skill, a one-time
 * secret): it names the kind in a short tag before the label, shows the
 * detail text when given, offers a Remove button only when the chip is
 * removable, and turns the label into a "Configure" button when clicked
 * setup is wired.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextChip } from "../ContextChip";

afterEach(cleanup);

describe("ContextChip", () => {
  it("tags the chip with its kind, shows the detail, and removes on click", () => {
    const onRemove = vi.fn();
    render(<ContextChip label="github" type="mcp" detail="4/12" onRemove={onRemove} />);

    expect(screen.getByText("MCP")).toBeTruthy();
    expect(screen.getByText("4/12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove github" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("names a one-time secret as such, and offers no Remove when the chip is read-only", () => {
    render(<ContextChip label="DEPLOY_KEY" type="secret" />);

    expect(screen.getByText("1-time")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove DEPLOY_KEY" })).toBeNull();
  });

  it("opens setup from the label when the chip needs it", () => {
    const onClick = vi.fn();
    render(<ContextChip label="Analyst" type="agent" status="needsSetup" onClick={onClick} onRemove={() => {}} />);

    const configure = screen.getByRole("button", { name: "Configure Analyst" });
    expect(configure.textContent).toContain("Agent");
    fireEvent.click(configure);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
