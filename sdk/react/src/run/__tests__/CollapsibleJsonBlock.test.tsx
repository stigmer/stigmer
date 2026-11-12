// Pins the collapsed JSON block an MCP call's long argument renders in
// (../tool-rendering-primitives.tsx): closed, it names its label and how many
// lines it holds, in the readable muted foreground (the subtle one fell
// under WCAG AA's 4.5:1 in dark mode, stigmer#3040); opened, it shows the
// content and drops the count.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { CollapsibleJsonBlock } from "../tool-rendering-primitives";

afterEach(cleanup);

describe("CollapsibleJsonBlock", () => {
  it("names a long block's line count in the readable muted foreground, and shows the content once opened", () => {
    render(<CollapsibleJsonBlock label="labels" content={'[\n  "bug",\n  "rounding"\n]'} />);
    const count = screen.getByText("(4 lines)");
    expect(count.className).toContain("stg:text-muted-foreground");
    expect(count.className).not.toContain("stg:text-muted-foreground-subtle");
    fireEvent.click(screen.getByRole("button", { name: /labels/ }));
    expect(screen.queryByText("(4 lines)")).toBeNull();
    expect(screen.getByText(/"rounding"/)).toBeTruthy();
  });

  it("names no count for a short block", () => {
    render(<CollapsibleJsonBlock label="team" content='"billing"' />);
    expect(screen.queryByText(/lines\)/)).toBeNull();
  });
});
