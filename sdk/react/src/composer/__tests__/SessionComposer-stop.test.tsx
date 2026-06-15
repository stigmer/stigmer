import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

describe("SessionComposer — Stop affordance", () => {
  it("renders Send (not Stop) when onStop is not provided", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Stop generating" }),
    ).toBeNull();
  });

  it("renders Stop (not Send) when onStop is provided", () => {
    renderComposer({ onStop: vi.fn(), disabled: true });

    expect(screen.getByRole("button", { name: "Stop generating" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).toBeNull();
  });

  it("clicking Stop calls onStop, even while the composer is disabled", () => {
    const onStop = vi.fn();
    renderComposer({ onStop, disabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("Stop stays clickable while stopping so the user can escalate", () => {
    const onStop = vi.fn();
    renderComposer({ onStop, disabled: true, isStopping: true });

    const stop = screen.getByRole("button", {
      name: "Stop generating",
    }) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);

    fireEvent.click(stop);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(2);
  });
});
