import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { samples } from "../../test/samples";
import { DefinitionDriftNotice } from "../DefinitionDriftNotice";
import type { McpServerDefinitionDrift } from "../useMcpServerDefinitionDrift";

afterEach(cleanup);

function drift(): McpServerDefinitionDrift {
  return {
    template: samples.mcpServer({ name: "Monday", org: "stigmer", slug: "monday" }),
    changedFields: ["headers", "authentication"],
  };
}

describe("DefinitionDriftNotice", () => {
  it("renders null when there is no drift", () => {
    const { container } = render(
      <DefinitionDriftNotice drift={null} onRefresh={() => {}} isRefreshing={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("says the configuration DIFFERS (never 'was updated') and names the fields", () => {
    render(
      <DefinitionDriftNotice drift={drift()} onRefresh={() => {}} isRefreshing={false} />,
    );
    const notice = screen.getByRole("status");
    // Honest copy: slug-matching is a heuristic, so the notice must state
    // a verifiable present-tense fact, not invent an update history.
    expect(notice.textContent).toContain("differs from the current marketplace definition");
    expect(notice.textContent).not.toContain("was updated");
    expect(notice.textContent).toContain("request headers, authentication");
    // The refresh promise: what survives.
    expect(notice.textContent).toContain("enabled tools and approval pins are kept");
  });

  it("fires onRefresh from the action button", async () => {
    const onRefresh = vi.fn();
    render(
      <DefinitionDriftNotice drift={drift()} onRefresh={onRefresh} isRefreshing={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh configuration" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows progress while refreshing", () => {
    render(
      <DefinitionDriftNotice drift={drift()} onRefresh={() => {}} isRefreshing />,
    );
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Refreshing…",
    });
    expect(button.disabled).toBe(true);
  });
});
