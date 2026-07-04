import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";
import { SessionComposer, type SessionComposerHandle } from "../SessionComposer";

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

describe("SessionComposer — imperative submit (Build from plan)", () => {
  it("submits a message with the interactionMode override, even when the picker is 'plan'", async () => {
    const ref = createRef<SessionComposerHandle>();
    const { onSubmit } = renderComposer({
      ref,
      showInteractionModePicker: true,
      interactionMode: "plan",
    });

    ref.current!.submit("Build from plan", { interactionMode: "agent" });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const [message, , context] = onSubmit.mock.calls[0];
    expect(message).toBe("Build from plan");
    // The override must win over the current picker value ("plan") so the
    // implement run executes in Agent mode regardless of render timing.
    expect(context?.interactionMode).toBe("agent");
  });

  it("no-ops when the composer is disabled", () => {
    const ref = createRef<SessionComposerHandle>();
    const { onSubmit } = renderComposer({ ref, disabled: true });

    ref.current!.submit("Build from plan", { interactionMode: "agent" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("no-ops on an empty/whitespace message", () => {
    const ref = createRef<SessionComposerHandle>();
    const { onSubmit } = renderComposer({ ref });

    ref.current!.submit("   ");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("carries caller-supplied attachments into the submit context (approved plan.md)", async () => {
    const ref = createRef<SessionComposerHandle>();
    const { onSubmit } = renderComposer({ ref });

    const planAttachment = {
      filename: "plan.md",
      storageKey: "attachments/01ABC/plan.md",
      mountPath: ".stigmer/inputs/plan.md",
      contentType: "text/markdown",
    };
    ref.current!.submit("Build from plan", {
      interactionMode: "agent",
      attachments: [planAttachment],
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.attachments).toEqual([planAttachment]);
    expect(context?.interactionMode).toBe("agent");
  });

  it("carries the buildFromPlan flag into the submit context", async () => {
    const ref = createRef<SessionComposerHandle>();
    const { onSubmit } = renderComposer({ ref });

    ref.current!.submit("Build from plan", {
      interactionMode: "agent",
      buildFromPlan: true,
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.buildFromPlan).toBe(true);
    expect(context?.interactionMode).toBe("agent");
  });

  it("leaves buildFromPlan unset for ordinary submissions", async () => {
    const { onSubmit } = renderComposer();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const [, , context] = onSubmit.mock.calls[0];
    expect(context?.buildFromPlan).toBeUndefined();
  });
});
