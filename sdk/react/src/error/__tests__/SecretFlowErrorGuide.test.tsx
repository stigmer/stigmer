/**
 * The guide for a run refused because a value it needs has no source.
 * Pinned against the server's refusal wording (the credential resolver's
 * "<declarer> needs <KEY>", declarers joined by "and"): each value is
 * listed under who needs it, a key two declarers need is listed under
 * both, other failed preconditions render nothing, and the guide names
 * the three ways to give a value.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StigmerError } from "@stigmer/sdk";
import { SecretFlowErrorGuide, isSecretFlowError, parseMissingVariables } from "../SecretFlowErrorGuide";

afterEach(cleanup);

const REFUSAL =
  "this run cannot start: MCP server 'linear' needs LINEAR_API_KEY, and you have not signed in to it: sign in, or save a credential of yours that serves it; " +
  "agent 'reviewer' and git host 'github.com' needs GITHUB_TOKEN: save a credential of yours that serves it, or ask an admin to let you use the organization's";

describe("SecretFlowErrorGuide", () => {
  it("reads every declarer and key the refusal names", () => {
    expect(parseMissingVariables(REFUSAL)).toEqual([
      { declarer: "MCP server 'linear'", variableName: "LINEAR_API_KEY" },
      { declarer: "agent 'reviewer'", variableName: "GITHUB_TOKEN" },
      { declarer: "git host 'github.com'", variableName: "GITHUB_TOKEN" },
    ]);
  });

  it("lists each value under who needs it and names the ways to give one", () => {
    render(<SecretFlowErrorGuide error={new StigmerError("failed-precondition", REFUSAL, 9)} />);
    const guide = screen.getByRole("alert");
    expect(guide.textContent).toContain("MCP server 'linear' needs:");
    expect(guide.textContent).toContain("git host 'github.com' needs:");
    expect(guide.textContent).toContain("Accounts and keys");
    expect(guide.textContent).toContain("session variables");
    expect(guide.textContent).toContain("Ask an admin");
  });

  it("renders nothing for another failed precondition or another code", () => {
    const other = new StigmerError("failed-precondition", "the schedule is paused", 9);
    expect(isSecretFlowError(other)).toBe(false);
    expect(isSecretFlowError(new StigmerError("internal", REFUSAL, 13))).toBe(false);
    render(<SecretFlowErrorGuide error={other} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
