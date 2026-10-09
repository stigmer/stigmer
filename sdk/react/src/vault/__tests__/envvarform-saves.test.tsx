/**
 * Where a typed value goes. A conversation and a connect keep no values of
 * their own, so EnvVarForm always saves in My vault:
 * - it offers no toggle to keep a value unsaved;
 * - its submit button reads "Save" unless the host names another label;
 * - it reports the values alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EnvVarForm } from "../EnvVarForm";

const VARIABLES = [{ key: "API_KEY", isSecret: true }];

afterEach(cleanup);

function fill(): void {
  fireEvent.change(screen.getByLabelText(/API_KEY/, { selector: "input" }), {
    target: { value: "k-1" },
  });
}

describe("EnvVarForm saves", () => {
  it("offers no way to keep a value unsaved, and submits the values alone", () => {
    const onSubmit = vi.fn();
    render(<EnvVarForm variables={VARIABLES} onSubmit={onSubmit} />);

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/Not saved/i)).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } });
  });

  it("uses the host's submit label when it names one", () => {
    const onSubmit = vi.fn();
    render(<EnvVarForm variables={VARIABLES} onSubmit={onSubmit} submitLabel="Save and connect" />);

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
