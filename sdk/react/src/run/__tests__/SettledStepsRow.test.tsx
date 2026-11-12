/**
 * Proves the one line a settled stretch of steps folds into
 * (SettledStepsRow): closed by default, it says the calls' own words and
 * the time they spanned, and opens and closes on a click to the steps it
 * folds; a prefix leads the words ("How it got there: read 1 file") or
 * stands alone when the calls have nothing to count, and a stretch with no
 * time leaves the time out; unframed, it is a divider row inside its
 * container rather than its own card; and with no words and no prefix it
 * draws its steps as they are, framed or not.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { samples } from "../../test";
import { SettledStepsRow } from "../SettledStepsRow";

afterEach(cleanup);

const read = samples.toolUse("read_file", "contents", { input: { path: "src/a.ts" } });
const think = samples.toolUse("think", "noted");

describe("SettledStepsRow", () => {
  it("says the calls' words and their time, closed, and opens and closes on a click", () => {
    render(
      <SettledStepsRow toolUses={[read]}>
        <p>the rows</p>
      </SettledStepsRow>,
    );
    const line = screen.getByRole("button", { name: "Read 1 file 1 s" });

    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("the rows")).toBeNull();
    expect(line.parentElement!.className).toContain("stg:mx-4");

    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(line.getAttribute("aria-controls")!)?.textContent).toBe("the rows");

    fireEvent.click(line);
    expect(screen.queryByText("the rows")).toBeNull();
  });

  it("leads the words with a prefix, lowercasing the calls' first word", () => {
    render(
      <SettledStepsRow toolUses={[read]} prefix="How it got there">
        <p>the rows</p>
      </SettledStepsRow>,
    );
    expect(screen.getByRole("button", { name: "How it got there: read 1 file 1 s" })).toBeTruthy();
  });

  it("shows a prefix alone when the calls have nothing to count, and no time when they span none", () => {
    render(
      <SettledStepsRow toolUses={[]} prefix="How it got there">
        <p>the rows</p>
      </SettledStepsRow>,
    );
    const line = screen.getByRole("button", { name: "How it got there" });
    expect(line.textContent).toBe("How it got there");

    cleanup();
    render(
      <SettledStepsRow toolUses={[think]} prefix="Steps so far">
        <p>the rows</p>
      </SettledStepsRow>,
    );
    expect(screen.getByRole("button", { name: "Steps so far 1 s" })).toBeTruthy();
  });

  it("draws a divider row, not a card, unframed, with the host's class", () => {
    render(
      <SettledStepsRow toolUses={[read]} framed={false} className="host-class">
        <p>the rows</p>
      </SettledStepsRow>,
    );
    const root = screen.getByRole("button").parentElement!;

    expect(root.className).toContain("stg:border-t");
    expect(root.className).toContain("host-class");
    expect(root.className).not.toContain("stg:mx-4");
    expect(root.className).not.toContain("stg:rounded-lg");
  });

  it("draws the steps as they are when there is nothing to say, framed or not", () => {
    render(
      <SettledStepsRow toolUses={[think]} framed={false} className="host-class">
        <p>the rows</p>
      </SettledStepsRow>,
    );
    const root = screen.getByText("the rows").parentElement!;

    expect(screen.queryByRole("button")).toBeNull();
    expect(root.className).toBe("host-class");

    cleanup();
    render(
      <SettledStepsRow toolUses={[think]}>
        <p>the rows</p>
      </SettledStepsRow>,
    );
    expect(screen.getByText("the rows").parentElement!.className).toBe("stg:mx-4");
  });
});
