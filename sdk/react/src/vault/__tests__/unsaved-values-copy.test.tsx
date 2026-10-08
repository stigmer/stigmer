/**
 * The words a person reads when they choose not to save a value: a value
 * typed for a conversation is kept sealed for the conversation and used by
 * all of its turns, a teammate's included, so nothing may promise it is
 * used once.
 * - EnvVarForm, by default, names the conversation on the submit button and
 *   in the note, and reports saveForFuture false.
 * - EnvVarForm with unsavedScope "connection" names the one connection.
 * - The save toggle names My vault, and turning it on submits "Save".
 * - SessionVariablesInput labels an unsaved entry "This conversation".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EnvVarForm } from "../EnvVarForm";
import { SessionVariablesInput } from "../../run/SessionVariablesInput";
import { useSessionVariables } from "../../run/useSessionVariables";

const VARIABLES = [{ key: "API_KEY", isSecret: true }];

afterEach(cleanup);

function fill(): void {
  fireEvent.change(screen.getByLabelText(/API_KEY/, { selector: "input" }), {
    target: { value: "k-1" },
  });
}

describe("unsaved values copy", () => {
  it("names the conversation, never a single use, by default", () => {
    const onSubmit = vi.fn();
    render(<EnvVarForm variables={VARIABLES} onSubmit={onSubmit} defaultSaveForFuture={false} />);

    expect(screen.getByText(/Kept sealed for this conversation and used by its turns/)).toBeTruthy();
    expect(screen.getByText(/including a teammate's turns if you share it/)).toBeTruthy();
    expect(screen.queryByText(/once|this run only/i)).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Use in this conversation" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } }, { saveForFuture: false });
  });

  it("names the one connection for a connect form", () => {
    render(
      <EnvVarForm variables={VARIABLES} onSubmit={vi.fn()} defaultSaveForFuture={false} unsavedScope="connection" />,
    );
    expect(screen.getByText("Used for this connection only. Not saved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use for this connection" })).toBeTruthy();
  });

  it("names My vault on the toggle, and submits Save once it is on", () => {
    const onSubmit = vi.fn();
    render(<EnvVarForm variables={VARIABLES} onSubmit={onSubmit} defaultSaveForFuture={false} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Save in My vault")).toBeTruthy();
    expect(screen.queryByText(/Kept sealed for this conversation/)).toBeNull();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ API_KEY: { value: "k-1", isSecret: true } }, { saveForFuture: true });
  });

  it("labels a session variable kept for this conversation until it is saved in My vault", () => {
    function Harness() {
      const sessionVariables = useSessionVariables();
      return (
        <>
          <button type="button" onClick={sessionVariables.addEntry}>
            add
          </button>
          <SessionVariablesInput sessionVariables={sessionVariables} />
        </>
      );
    }
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "add" }));
    });

    const toggle = screen.getByRole("switch", { name: "Kept for this conversation" });
    expect(screen.getByText("This conversation")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("switch", { name: "Saved in My vault" })).toBeTruthy();
    expect(screen.getByText("Save in My vault")).toBeTruthy();
  });
});
