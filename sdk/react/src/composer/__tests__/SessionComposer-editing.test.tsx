import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer } from "../SessionComposer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalStigmerMock(): Stigmer {
  return {
    agentExecution: { uploadAttachment: vi.fn() },
    environment: { getPersonal: vi.fn().mockResolvedValue(null) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: {
      baseUrl: "http://localhost:8080",
      getAccessToken: vi.fn().mockResolvedValue(""),
    },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        <ModelRegistryContext.Provider
          value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}
        >
          {children}
        </ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

function renderComposer(
  props?: Partial<React.ComponentProps<typeof SessionComposer>>,
) {
  const client = createMinimalStigmerMock();
  const onSubmit = vi.fn();
  const result = render(
    <SessionComposer onSubmit={onSubmit} {...props} />,
    { wrapper: createWrapper(client) },
  );
  return { ...result, onSubmit, client };
}

function getTextarea(): HTMLTextAreaElement {
  return document.querySelector("textarea") as HTMLTextAreaElement;
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — editing mode (edit-and-resubmit)", () => {
  it("renders no editing banner by default (backward compatible)", () => {
    renderComposer();

    expect(screen.queryByText("Editing message")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cancel editing" }),
    ).toBeNull();
  });

  it("renders the editing banner with a cancel affordance while isEditing", () => {
    renderComposer({ isEditing: true, onCancelEdit: vi.fn() });

    expect(screen.getByText("Editing message")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancel editing" }),
    ).toBeTruthy();
  });

  it("clicking the banner X calls onCancelEdit", () => {
    const onCancelEdit = vi.fn();
    renderComposer({ isEditing: true, onCancelEdit });

    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("Escape in the textarea calls onCancelEdit while editing", () => {
    const onCancelEdit = vi.fn();
    renderComposer({ isEditing: true, onCancelEdit });

    fireEvent.keyDown(getTextarea(), { key: "Escape" });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when not editing", () => {
    const onCancelEdit = vi.fn();
    renderComposer({ isEditing: false, onCancelEdit });

    fireEvent.keyDown(getTextarea(), { key: "Escape" });
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("Enter still submits while editing — cancel is Escape-only", async () => {
    const onCancelEdit = vi.fn();
    const { onSubmit } = renderComposer({ isEditing: true, onCancelEdit });

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "corrected message" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0]).toBe("corrected message");
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("renders the banner without a cancel button when onCancelEdit is omitted", () => {
    renderComposer({ isEditing: true });

    expect(screen.getByText("Editing message")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cancel editing" }),
    ).toBeNull();
  });
});
