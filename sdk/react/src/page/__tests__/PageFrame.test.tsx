/**
 * Pins the console's one page column: wide by default (lists, tables,
 * settings), a reading width for a single column, and the same margins at
 * both, so moving between zones never shifts the page's left edge.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageFrame } from "../PageFrame";

afterEach(cleanup);

const MARGINS = ["stg:mx-auto", "stg:w-full", "stg:px-4", "stg:py-6", "stg:sm:px-6", "stg:sm:py-8"];

describe("PageFrame", () => {
  it("frames a page at the wide width with the console's margins", () => {
    render(
      <PageFrame>
        <p>Agents</p>
      </PageFrame>,
    );
    const frame = screen.getByText("Agents").parentElement!;
    expect(frame.className).toContain("stg:max-w-5xl");
    for (const cls of MARGINS) expect(frame.className).toContain(cls);
  });

  it("frames a single column at the reading width with the same margins", () => {
    render(
      <PageFrame width="reading">
        <p>Profile</p>
      </PageFrame>,
    );
    const frame = screen.getByText("Profile").parentElement!;
    expect(frame.className).toContain("stg:max-w-3xl");
    expect(frame.className).not.toContain("stg:max-w-5xl");
    for (const cls of MARGINS) expect(frame.className).toContain(cls);
  });
});
