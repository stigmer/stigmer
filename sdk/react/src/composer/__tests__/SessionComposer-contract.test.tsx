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

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer — public contract", () => {
  it("renders with role='form' and default aria-label", () => {
    renderComposer();

    const form = screen.getByRole("form");
    expect(form).toBeTruthy();
    expect(form.getAttribute("aria-label")).toBe("Send message");
  });

  it("renders with custom aria-label", () => {
    renderComposer({ ariaLabel: "Compose reply" });

    const form = screen.getByRole("form");
    expect(form.getAttribute("aria-label")).toBe("Compose reply");
  });

  it("renders a textarea", () => {
    renderComposer();

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeTruthy();
    expect(textarea.tagName.toLowerCase()).toBe("textarea");
  });

  it("textarea reflects placeholder prop", () => {
    renderComposer({ placeholder: "Ask anything..." });

    const textarea = screen.getByRole("textbox");
    expect(textarea.getAttribute("placeholder")).toBe("Ask anything...");
  });

  it("textarea is disabled when disabled=true", () => {
    renderComposer({ disabled: true });

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveProperty("disabled", true);
  });

  it("textarea is disabled when isSubmitting=true", () => {
    renderComposer({ isSubmitting: true });

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveProperty("disabled", true);
  });

  it("fires onSubmit with message content on Enter", async () => {
    const { onSubmit } = renderComposer();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0][0]).toBe("Hello world");
  });

  it("does not fire onSubmit when message is empty", () => {
    const { onSubmit } = renderComposer();

    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
