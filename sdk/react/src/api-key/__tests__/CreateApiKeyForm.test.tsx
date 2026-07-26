import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { CreateApiKeyForm } from "../CreateApiKeyForm";

afterEach(cleanup);

function createWrapper() {
  const mockClient = {
    apiKey: { create: vi.fn() },
  } as unknown as Stigmer;

  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={mockClient}>
      {children}
    </StigmerContext.Provider>
  );
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Name") as HTMLInputElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Create API key",
  }) as HTMLButtonElement;
}

describe("CreateApiKeyForm initialName", () => {
  it("starts with an empty name and a disabled submit by default", () => {
    render(<CreateApiKeyForm org="acme" />, { wrapper: createWrapper() });

    expect(nameInput().value).toBe("");
    expect(submitButton().disabled).toBe(true);
  });

  it("seeds the name field and enables submit when initialName is set", () => {
    render(<CreateApiKeyForm org="acme" initialName="quickstart-key" />, {
      wrapper: createWrapper(),
    });

    expect(nameInput().value).toBe("quickstart-key");
    expect(submitButton().disabled).toBe(false);
  });

  it("keeps the seeded field editable — initialName is a seed, not a lock", () => {
    render(<CreateApiKeyForm org="acme" initialName="quickstart-key" />, {
      wrapper: createWrapper(),
    });

    fireEvent.change(nameInput(), { target: { value: "renamed-key" } });

    expect(nameInput().value).toBe("renamed-key");
  });
});
