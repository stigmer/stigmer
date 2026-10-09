/**
 * The words a person reads about where a typed value goes. A conversation
 * keeps no values of its own, so a form typed for a chat always saves in
 * My vault; only a connect form may use a value once and keep nothing.
 * - EnvVarForm, by default, offers no save toggle, submits "Save", and
 *   reports saveForFuture true, whatever `defaultSaveForFuture` says.
 * - EnvVarForm with unsavedScope "connection" names the one connection on
 *   the submit button and in the note, and reports saveForFuture false.
 * - The save toggle names My vault, and turning it on submits "Save".
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

describe("unsaved values copy", () => {
  it("offers no way to keep a value unsaved by default, and saves", () => {
    const onSubmit = vi.fn();
    render(<EnvVarForm variables={VARIABLES} onSubmit={onSubmit} defaultSaveForFuture={false} />);

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/this conversation/i)).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } }, { saveForFuture: true });
  });

  it("names the one connection for a connect form, and keeps the value unsaved", () => {
    const onSubmit = vi.fn();
    render(
      <EnvVarForm variables={VARIABLES} onSubmit={onSubmit} defaultSaveForFuture={false} unsavedScope="connection" />,
    );
    expect(screen.getByText("Used for this connection only. Not saved.")).toBeTruthy();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Use for this connection" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } }, { saveForFuture: false });
  });

  it("names My vault on the toggle, and submits Save once it is on", () => {
    const onSubmit = vi.fn();
    render(
      <EnvVarForm variables={VARIABLES} onSubmit={onSubmit} defaultSaveForFuture={false} unsavedScope="connection" />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Save in My vault")).toBeTruthy();
    expect(screen.queryByText(/Used for this connection only/)).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } }, { saveForFuture: true });
  });
});
