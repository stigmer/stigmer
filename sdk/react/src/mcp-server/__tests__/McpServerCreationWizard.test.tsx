/**
 * The MCP server creation wizard walks its steps in order: identity and
 * transport first, refusing to move on without a name, then the variables
 * and sign-in step, and back again. The create hook is replaced, because
 * these cases never reach the review step's submit.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../useCreateMcpServer.js", () => ({
  useCreateMcpServer: () => ({
    create: async () => {
      throw new Error("not reached in these cases");
    },
    isCreating: false,
    error: null,
    clearError: () => {},
  }),
}));

import { McpServerCreationWizard } from "../McpServerCreationWizard";

afterEach(cleanup);

function nextButton(): HTMLElement {
  return screen.getByRole("button", { name: "Next" });
}

describe("McpServerCreationWizard", () => {
  it("moves from identity and transport to variables and sign-in, and back", () => {
    render(
      <McpServerCreationWizard
        org="acme"
        initialData={{ name: "Linear", transportType: "http", httpUrl: "https://mcp.linear.app/mcp" }}
        onComplete={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Identity & Transport" })).toBeTruthy();

    fireEvent.click(nextButton());
    expect(screen.getByRole("heading", { name: "Variables & Sign-in" })).toBeTruthy();
    expect(screen.getByText("Sign-in")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Identity & Transport" })).toBeTruthy();
  });

  it("stays on identity and transport while the server has no name", () => {
    render(
      <McpServerCreationWizard
        org="acme"
        initialData={{ name: "", transportType: "http", httpUrl: "https://mcp.linear.app/mcp" }}
        onComplete={() => {}}
      />,
    );
    fireEvent.click(nextButton());
    expect(screen.getByRole("heading", { name: "Identity & Transport" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Variables & Sign-in" })).toBeNull();
  });
});
