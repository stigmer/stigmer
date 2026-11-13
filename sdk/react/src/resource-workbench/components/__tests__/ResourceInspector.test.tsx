/**
 * ResourceInspector: open, it shows its content in a labelled panel whose
 * close button reports the close; closed, it renders nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceInspector } from "../ResourceInspector";

afterEach(cleanup);

describe("ResourceInspector", () => {
  it("shows its content and reports the close button", () => {
    const onClose = vi.fn();
    render(
      <ResourceInspector open onClose={onClose} aria-label="Agent preview">
        <p>support-bot</p>
      </ResourceInspector>,
    );

    const panel = screen.getByRole("complementary", { name: "Agent preview" });
    expect(panel.textContent).toContain("support-bot");
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    render(
      <ResourceInspector open={false} onClose={vi.fn()}>
        <p>support-bot</p>
      </ResourceInspector>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText("support-bot")).toBeNull();
  });
});
