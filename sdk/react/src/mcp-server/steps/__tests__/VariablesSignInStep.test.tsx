/**
 * The wizard's variables and sign-in step offers sign-in for an HTTP server
 * only: a local program is told to declare its keys as environment
 * variables, and no sign-in section is shown for it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VariablesSignInStep } from "../VariablesSignInStep";
import { createInitialMcpServerWizardData } from "../types";

afterEach(cleanup);

describe("VariablesSignInStep (MCP server)", () => {
  it("offers sign-in for an HTTP server", () => {
    render(
      <VariablesSignInStep
        data={{ ...createInitialMcpServerWizardData(), transportType: "http" }}
        updateData={() => {}}
      />,
    );
    expect(screen.getByText("Sign-in")).toBeTruthy();
  });

  it("tells a local program to declare its keys, with no sign-in section", () => {
    render(
      <VariablesSignInStep
        data={{ ...createInitialMcpServerWizardData(), transportType: "stdio" }}
        updateData={() => {}}
      />,
    );
    expect(screen.getByText(/A local program takes its keys as environment variables/)).toBeTruthy();
    expect(screen.queryByText("Sign-in")).toBeNull();
  });
});
