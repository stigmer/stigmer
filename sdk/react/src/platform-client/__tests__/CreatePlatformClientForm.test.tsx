/**
 * Pins the sign-in settings the platform-client create form sends:
 *
 *   - a new client creates its users' accounts and grants them viewer,
 *     unless the admin picks another role;
 *   - turning account creation off sends neither setting, because only an
 *     account the client creates receives the sign-in role;
 *   - a stored role reads by its own name, and an unspecified one as
 *     "None", which grants nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { PlatformClientCreateResponseSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { PlatformClientInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { CreatePlatformClientForm } from "../CreatePlatformClientForm";
import { formatClientSignInRole } from "../SignInSettings";

const CREATED = create(PlatformClientCreateResponseSchema, {});

function renderForm(createClient: ReturnType<typeof vi.fn>) {
  const client = { platformclient: { create: createClient } } as never;
  render(
    <StigmerContext.Provider value={client}>
      <CreatePlatformClientForm org="acme" />
    </StigmerContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "embed-client" },
  });
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: "Create platform client" }),
  );
}

afterEach(cleanup);

describe("CreatePlatformClientForm sign-in settings", () => {
  it("creates accounts with viewer by default", async () => {
    const createClient = vi.fn(async (_input: PlatformClientInput) => CREATED);
    renderForm(createClient);
    submit();

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    const input = createClient.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBe(true);
    expect(input.signInRole).toBe(IamRole.viewer);
  });

  it("sends the sign-in role the admin picks", async () => {
    const createClient = vi.fn(async (_input: PlatformClientInput) => CREATED);
    renderForm(createClient);
    fireEvent.change(screen.getByLabelText("Sign-in role"), {
      target: { value: String(IamRole.member) },
    });
    submit();

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    expect(createClient.mock.calls[0]![0].signInRole).toBe(IamRole.member);
  });

  it("sends neither setting when account creation is off", async () => {
    const createClient = vi.fn(async (_input: PlatformClientInput) => CREATED);
    renderForm(createClient);
    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    expect(
      (screen.getByLabelText("Sign-in role") as HTMLSelectElement).disabled,
    ).toBe(true);
    submit();

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    const input = createClient.mock.calls[0]![0];
    expect(input.createAccountsOnSignIn).toBeUndefined();
    expect(input.signInRole).toBeUndefined();
  });
});

describe("formatClientSignInRole", () => {
  it("names each role, and reads unspecified as None", () => {
    expect(formatClientSignInRole(IamRole.viewer)).toBe("Viewer");
    expect(formatClientSignInRole(IamRole.member)).toBe("Member");
    expect(formatClientSignInRole(IamRole.admin)).toBe("Admin");
    expect(formatClientSignInRole(IamRole.owner)).toBe("Owner");
    expect(formatClientSignInRole(IamRole.iam_role_unspecified)).toBe("None");
  });
});
