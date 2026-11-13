/**
 * InlineEditKeyValue's row removal: each row in the editor carries a
 * Remove control named by its key, and removing one drops it from the
 * draft so Save changes hands back only the rows that are left.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineEditKeyValue } from "../InlineEditKeyValue.js";
import type { KeyValueRow } from "../types.js";

afterEach(cleanup);

const TOKEN: KeyValueRow = { key: "GITHUB_TOKEN", value: "", isSecret: true };
const REGION: KeyValueRow = { key: "REGION", value: "us-east-1", isSecret: false };

describe("InlineEditKeyValue row removal", () => {
  it("removes a row from the draft and saves the rows that are left", async () => {
    const onSave = vi.fn<(rows: KeyValueRow[]) => Promise<boolean>>().mockResolvedValue(true);
    render(<InlineEditKeyValue value={[TOKEN, REGION]} onSave={onSave} editing showValue />);

    fireEvent.click(screen.getByRole("button", { name: "Remove GITHUB_TOKEN" }));

    expect(screen.queryByRole("button", { name: "Remove GITHUB_TOKEN" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove REGION" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith([REGION]));
  });
});
