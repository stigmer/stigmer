/**
 * The landing page's "What you'd build" table.
 *
 * Pins one row per point of what each customer's agent has, in the
 * vocabulary's order: the job that runs for hours is second, beside the
 * request-length calls, queues and retries a team would write instead.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Problem } from "../Problem";

afterEach(cleanup);

describe("Problem", () => {
  it("sets five rows beside what you'd build, the job that runs for hours second", () => {
    render(<Problem />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.querySelectorAll("td")[1]?.textContent)).toEqual([
      "Each customer's agent has its own computer",
      "It works on a job for hours and survives restarts",
      "It asks before acting on what you mark",
      "Each customer's agents, files and keys stay apart (how, by edition)",
      "Your model keys, on your servers or ours",
    ]);
    expect(rows[1].querySelector("td")?.textContent).toBe(
      "Request-length calls, queues and retries you wrote",
    );
  });
});
