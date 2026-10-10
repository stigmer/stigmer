/**
 * Pins the service-account create flow (`CreateServiceAccountForm`):
 *
 *   - the role picker offers Admin, Member and Viewer, never Owner, with
 *     Member preselected, and the create sends the organization, the trimmed
 *     name and the chosen role;
 *   - the account exists from the first answer: `onCreated` fires before any
 *     key is offered, and declining the key ("Not now") ends the flow with
 *     no key request sent;
 *   - a first key is created for the new account, never for the caller, and
 *     its raw value is shown once, with the flow ending on dismiss;
 *   - a refused create says why and leaves the form on the first step.
 *
 * The generated client is a fake behind the one provider seam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { CreateServiceAccountKeyInput } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { CreateServiceAccountInput } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { StigmerContext } from "../../context";
import { CreateServiceAccountForm } from "../CreateServiceAccountForm";

const sent = vi.hoisted(() => ({
  accounts: [] as CreateServiceAccountInput[],
  keys: [] as CreateServiceAccountKeyInput[],
  refuseCreate: false,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    identityAccount: {
      createServiceAccount: async (input: CreateServiceAccountInput) => {
        sent.accounts.push(input);
        if (sent.refuseCreate) throw new Error("a service account named ci-deploy already exists");
        return create(IdentityAccountSchema, {
          metadata: { id: "ida_sa_ci", name: input.name, org: input.org },
        });
      },
    },
    apiKey: {
      createForServiceAccount: async (input: CreateServiceAccountKeyInput) => {
        sent.keys.push(input);
        return create(ApiKeySchema, {
          metadata: { id: "key_1", name: input.name },
          spec: { keyHash: "stk_raw_once", fingerprint: "a1b2c3" },
        });
      },
    },
  } as unknown as Stigmer;
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

afterEach(() => {
  cleanup();
  sent.accounts = [];
  sent.keys = [];
  sent.refuseCreate = false;
});

function fillName(value: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value } });
}

describe("CreateServiceAccountForm", () => {
  it("offers Admin, Member and Viewer, never Owner, with Member preselected", () => {
    render(<CreateServiceAccountForm org="org_acme" />, { wrapper });
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const labels = radios.map((radio) => radio.closest("label")?.textContent ?? "");
    expect(labels).toEqual([
      expect.stringMatching(/^Admin/),
      expect.stringMatching(/^Member/),
      expect.stringMatching(/^Viewer/),
    ]);
    expect((screen.getByRole("radio", { name: /^Member/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("creates the account with the organization, the trimmed name and the chosen role, then offers a key", async () => {
    const created: string[] = [];
    render(
      <CreateServiceAccountForm
        org="org_acme"
        onCreated={(account) => created.push(account.metadata?.id ?? "")}
      />,
      { wrapper },
    );
    fillName("  ci-deploy ");
    fireEvent.click(screen.getByRole("radio", { name: /^Admin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create service account" }));

    await screen.findByText("ci-deploy created with the Admin role");
    expect(sent.accounts.map((a) => [a.org, a.name, a.role])).toEqual([
      ["org_acme", "ci-deploy", IamRole.admin],
    ]);
    expect(created).toEqual(["ida_sa_ci"]);
  });

  it("ends the flow when the first key is declined, sending no key request", async () => {
    const onDone = vi.fn();
    render(<CreateServiceAccountForm org="org_acme" onDone={onDone} />, { wrapper });
    fillName("ci-deploy");
    fireEvent.click(screen.getByRole("button", { name: "Create service account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(sent.keys).toEqual([]);
  });

  it("creates the first key for the new account and shows its raw value once", async () => {
    const onDone = vi.fn();
    render(<CreateServiceAccountForm org="org_acme" onDone={onDone} />, { wrapper });
    fillName("ci-deploy");
    fireEvent.click(screen.getByRole("button", { name: "Create service account" }));
    fireEvent.change(await screen.findByLabelText("Key name"), {
      target: { value: "github-actions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText("stk_raw_once")).toBeTruthy();
    expect(sent.keys.map((k) => [k.serviceAccountId, k.name, k.neverExpires])).toEqual([
      ["ida_sa_ci", "github-actions", true],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("says why a create was refused and stays on the first step", async () => {
    sent.refuseCreate = true;
    render(<CreateServiceAccountForm org="org_acme" />, { wrapper });
    fillName("ci-deploy");
    fireEvent.click(screen.getByRole("button", { name: "Create service account" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already exists/));
    expect(screen.getByRole("button", { name: "Create service account" })).toBeTruthy();
  });
});
