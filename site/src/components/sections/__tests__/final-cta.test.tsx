/**
 * The landing page's closing call to action and its SDK snippet tabs.
 *
 * Pins that each tab shows its own install command and a first agent run in
 * that language (the snippets are the first code a visitor copies, so a tab
 * showing another language's code, or a run call the SDK no longer has, is a
 * visible defect), and that TypeScript is the tab shown first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FinalCTA } from "../FinalCTA";

afterEach(cleanup);

function code(): string {
  const pre = document.querySelector("pre");
  if (!pre) throw new Error("no code block rendered");
  return pre.textContent ?? "";
}

describe("FinalCTA SDK snippets", () => {
  it("opens on the TypeScript run snippet", () => {
    render(<FinalCTA />);

    expect(screen.getByText("npm install @stigmer/sdk")).toBeTruthy();
    expect(code()).toContain("const run = await stigmer.run.create({");
    expect(code()).toContain('message: "Can I return these shoes?",');
  });

  it.each([
    ["Go", "go get github.com/stigmer/stigmer/sdk/go/v3", "run, _ := client.Run.Create(ctx,"],
    ["Python", "pip install stigmer", "run = client.agent_runs.create("],
    ["Java", 'implementation("ai.stigmer:stigmer-java:0.1.0")', "var run = client.run.create("],
  ])("switches to the %s install command and run snippet", (label, install, call) => {
    render(<FinalCTA />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.getByText(install)).toBeTruthy();
    expect(code()).toContain(call);
  });
});
