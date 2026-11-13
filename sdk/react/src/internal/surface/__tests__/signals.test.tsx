/**
 * Pins the neutral tag (a word or a number on the muted chip, 12px on
 * 20px, never a status hue) and the notice's tones (failed announced as
 * an alert, paused and plain as a status, each on its tint).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Tag } from "../Tag";
import { Notice } from "../Notice";

afterEach(cleanup);

describe("Tag", () => {
  it("draws a word on the muted chip, 12px on 20px, with no status hue", () => {
    render(<Tag>Admin</Tag>);
    const tag = screen.getByText("Admin");
    for (const cls of ["stg:h-5", "stg:text-xs", "stg:bg-muted", "stg:text-foreground", "stg:rounded-md"]) expect(tag.className).toContain(cls);
    expect(tag.className).not.toMatch(/status/);
  });

  it("draws an identifier in the monospace face", () => {
    render(<Tag mono>sk_live</Tag>);
    expect(screen.getByText("sk_live").className).toContain("stg:font-mono");
  });
});

describe("Notice", () => {
  it.each([
    ["failed", "alert", "stg:bg-status-failed-subtle"],
    ["paused", "status", "stg:bg-status-degraded-subtle"],
    ["plain", "status", "stg:bg-muted"],
  ] as const)("draws the %s tone as %s on its tint", (tone, role, tint) => {
    render(<Notice tone={tone} headline="It happened." />);
    const note = screen.getByRole(role);
    expect(note.className).toContain(tint);
    expect(note.className).toContain("stg:rounded-xl");
    expect(note.textContent).toContain("It happened.");
  });
});
