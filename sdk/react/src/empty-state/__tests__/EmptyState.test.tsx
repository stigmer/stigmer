/**
 * Pins the console's empty state: on its own faint card, the icon in a
 * muted square, the title in the foreground, one line, and the act as the
 * screen's primary button; the search that matched nothing named in the
 * zero-results title; the permission words; the error's own message; and
 * the inline size, one line inside a card or a list with no frame.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "../EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("draws the panel: faint card, title in the foreground, one line, and its act", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        variant="first-use"
        resourceLabel="API keys"
        description="Make one for the CLI on a server, a CI job or a script."
        action={{ label: "New API key", onClick }}
      />,
    );
    const panel = screen.getByRole("status");
    for (const cls of ["stg:rounded-xl", "stg:border", "stg:bg-muted-faint"]) expect(panel.className).toContain(cls);
    expect(panel.className).not.toContain("stg:border-dashed");
    const title = screen.getByText("No API keys yet");
    expect(title.className).toContain("stg:text-foreground");
    expect(title.className).toContain("stg:font-semibold");
    fireEvent.click(screen.getByRole("button", { name: "New API key" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("names the search that matched nothing", () => {
    render(<EmptyState variant="zero-results" resourceLabel="plugins" query="ledgr" />);
    expect(screen.getByText("Nothing matches “ledgr”")).toBeTruthy();
    expect(screen.getByText("Check the spelling, or clear the search to see every plugin.")).toBeTruthy();
  });

  it("says who can open a page the viewer can't", () => {
    render(<EmptyState variant="permission" resourceLabel="service accounts" />);
    expect(screen.getByText("Only an admin can open service accounts")).toBeTruthy();
    expect(screen.getByText("Ask an admin of this organization for access.")).toBeTruthy();
  });

  it("carries the error's own message as an alert", () => {
    render(<EmptyState variant="error" errorMessage="Network request failed" />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load this.");
    expect(screen.getByText(/Network request failed/)).toBeTruthy();
  });

  it("draws one line with no frame at the inline size", () => {
    render(<EmptyState variant="first-use" size="inline" title="No secrets yet" description="Add one to use it in a run." />);
    const line = screen.getByRole("status");
    expect(line.className).not.toContain("stg:rounded-xl");
    expect(line.className).not.toContain("stg:bg-muted-faint");
    expect(line.textContent).toBe("No secrets yet Add one to use it in a run.");
  });

  it("draws no default line under an inline first-use title, and keeps a search's default line inline", () => {
    const { rerender } = render(<EmptyState variant="first-use" size="inline" title="No secrets saved." />);
    expect(screen.getByRole("status").textContent).toBe("No secrets saved.");
    rerender(<EmptyState variant="zero-results" size="inline" resourceLabel="models" query="gpt" />);
    expect(screen.getByRole("status").textContent).toBe("Nothing matches \u201cgpt\u201d Check the spelling, or clear the search to see every model.");
  });
});
