/**
 * Pins what the run zone says when a `/runs/<id>` address resolves to no
 * run: it names the missing run, not a missing page, and offers the way back
 * to the dashboard.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunNotFound } from "../RunNotFound";

describe("RunNotFound", () => {
  it("names the missing run and links back to the dashboard", () => {
    render(<RunNotFound />);

    expect(screen.getByRole("heading", { name: "Run not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/");
  });
});
