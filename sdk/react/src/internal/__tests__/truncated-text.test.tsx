// Fast structural pins for TruncatedText (the native-title sweep's
// truncation replacement, stigmer-cloud#268). Happy-dom can honestly pin
// the STRUCTURE — full text in the DOM, zero native titles, zero new tab
// stops; the overflow-gated REVEAL needs real layout and lives in
// truncated-text.layout.test.tsx.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { TruncatedText } from "../truncated-text.js";

afterEach(cleanup);

describe("TruncatedText", () => {
  it("renders the full text in the DOM with no native title and no tab stop", () => {
    render(<TruncatedText text="models/anthropic/claude-4.6-opus" />);

    // CSS truncation is purely visual: screen readers and selection get
    // the full value from the DOM, so no sr-only duplicate is needed.
    const span = screen.getByText("models/anthropic/claude-4.6-opus");
    expect(span.closest("[title]")).toBeNull();
    expect(span.closest("[tabindex]")).toBeNull();
  });

  it("applies stg:truncate by default and yields to a line-clamp class", () => {
    const { rerender } = render(<TruncatedText text="abc" />);
    expect(screen.getByText("abc").className).toContain("stg:truncate");

    rerender(<TruncatedText text="abc" className="stg:line-clamp-2" />);
    const clamped = screen.getByText("abc");
    expect(clamped.className).toContain("stg:line-clamp-2");
    expect(clamped.className).not.toContain("stg:truncate");
  });
});
