/**
 * A channel app's copy row: a read-only field at the fields' size, whose
 * whole value is selected when it takes focus so it can be copied by hand
 * too, with Copy beside it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopyRow } from "../internal";

afterEach(cleanup);

describe("CopyRow", () => {
  it("selects the whole value on focus, read only, with Copy beside it", () => {
    const url = "https://api.stigmer.ai/webhook/slack/chapp_s";
    render(<CopyRow label="Events request URL" value={url} />);
    const field = screen.getByLabelText("Events request URL") as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    fireEvent.focus(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, url.length]);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});
