/**
 * Pins the identity-provider sign-in settings every provider form shares:
 *
 *   - the input sends what the admin set: the customer id claim trimmed,
 *     and an unset field as undefined so an update clears it;
 *   - a stored role reads by its own name, and an unspecified one as
 *     "None", never as a role it does not grant;
 *   - the section's toggle and claim field report what the admin set.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import {
  EMPTY_SIGN_IN_SETTINGS,
  formatSignInRole,
  SignInSettingsSection,
  toSignInInput,
  type SignInSettings,
} from "../SignInSettings";

afterEach(cleanup);

const DELEGATION: SignInSettings = {
  createAccounts: false,
  signInRole: IamRole.member,
  externalIdClaim: "org_id",
};

describe("toSignInInput", () => {
  it("sends a delegation provider's customer id claim, trimmed", () => {
    expect(
      toSignInInput({ ...DELEGATION, externalIdClaim: "  org_id " }),
    ).toEqual({
      createAccountsOnSignIn: undefined,
      signInRole: IamRole.member,
      externalIdClaim: "org_id",
    });
  });

  it("sends every unset field as undefined, so an update clears it", () => {
    expect(
      toSignInInput({ ...EMPTY_SIGN_IN_SETTINGS, externalIdClaim: "   " }),
    ).toEqual({
      createAccountsOnSignIn: undefined,
      signInRole: undefined,
      externalIdClaim: undefined,
    });
  });
});

describe("formatSignInRole", () => {
  it("names each role, and reads unspecified as None", () => {
    expect(formatSignInRole(IamRole.viewer)).toBe("Viewer");
    expect(formatSignInRole(IamRole.member)).toBe("Member");
    expect(formatSignInRole(IamRole.admin)).toBe("Admin");
    expect(formatSignInRole(IamRole.owner)).toBe("Owner");
    expect(formatSignInRole(IamRole.iam_role_unspecified)).toBe("None");
  });
});

describe("SignInSettingsSection", () => {
  it("reports the create-accounts toggle and the customer id claim the admin sets", () => {
    const onChange = vi.fn();
    render(
      <SignInSettingsSection
        value={EMPTY_SIGN_IN_SETTINGS}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Create accounts on sign-in" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_SIGN_IN_SETTINGS,
      createAccounts: true,
    });

    fireEvent.change(screen.getByLabelText("Customer id claim"), {
      target: { value: "org_id" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_SIGN_IN_SETTINGS,
      externalIdClaim: "org_id",
    });
  });
});
