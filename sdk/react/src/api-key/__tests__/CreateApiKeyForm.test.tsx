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

describe("CreateApiKeyForm organization limit", () => {
  function renderWithCreate(org = "org_acme") {
    const create = vi.fn(async (_input: Record<string, unknown>) => ({}));
    const client = { apiKey: { create } } as unknown as Stigmer;
    render(<CreateApiKeyForm org={org} initialName="ci-key" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StigmerContext.Provider value={client}>
          {children}
        </StigmerContext.Provider>
      ),
    });
    return create;
  }

  it("limits the key to the active organization by default", async () => {
    const create = renderWithCreate();
    const box = screen.getByLabelText(
      "This organization only",
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(submitButton());
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      org: "org_acme",
      boundOrg: "org_acme",
    });
  });

  it("holds a limited key until an organization is active, never sending an empty limit", async () => {
    const create = renderWithCreate("");
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Open an organization to limit the key to it, or clear the box.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText("This organization only"));
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("boundOrg");
  });

  it("creates a key for every organization when the box is cleared", async () => {
    const create = renderWithCreate();
    fireEvent.click(screen.getByLabelText("This organization only"));
    expect(
      screen.getByText(
        "The key works in every organization your sign-in reaches.",
      ),
    ).toBeTruthy();

    fireEvent.click(submitButton());
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("boundOrg");
  });
});
