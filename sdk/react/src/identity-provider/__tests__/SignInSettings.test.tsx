/**
 * Pins the identity-provider sign-in settings every provider form shares:
 *
 *   - turning SSO on starts from account creation on, viewer when no role
 *     is chosen, and no customer id claim; turning it off again puts back every
 *     field the switch filled and the admin left alone, and keeps what the
 *     admin changed meanwhile;
 *   - an SSO provider never sends a customer id claim, because the claim routes
 *     a sign-in to a child organization and SSO signs people in to the
 *     provider's own; the section hides the field for SSO;
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
  withoutSsoDefaults,
  withSsoDefaults,
  type SignInSettings,
} from "../SignInSettings";

afterEach(cleanup);

const DELEGATION: SignInSettings = {
  createAccounts: false,
  signInRole: IamRole.member,
  externalIdClaim: "org_id",
};

describe("withoutSsoDefaults", () => {
  it("puts back every field the SSO switch filled and the admin left alone", () => {
    const before = DELEGATION;
    expect(withoutSsoDefaults(withSsoDefaults(before, true), before)).toEqual(
      before,
    );
    expect(
      withoutSsoDefaults(
        withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true),
        EMPTY_SIGN_IN_SETTINGS,
      ),
    ).toEqual(EMPTY_SIGN_IN_SETTINGS);
  });

  it("keeps a field the admin changed while SSO was on", () => {
    const filled = withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true);
    expect(
      withoutSsoDefaults(
        { ...filled, signInRole: IamRole.admin },
        EMPTY_SIGN_IN_SETTINGS,
      ),
    ).toEqual({ ...EMPTY_SIGN_IN_SETTINGS, signInRole: IamRole.admin });
  });
});

describe("withSsoDefaults", () => {
  it("leaves a non-SSO provider's settings as the admin chose them", () => {
    expect(withSsoDefaults(DELEGATION, false)).toBe(DELEGATION);
  });

  it("starts an SSO provider with account creation, viewer and no customer id claim", () => {
    expect(withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true)).toEqual({
      createAccounts: true,
      signInRole: IamRole.viewer,
      externalIdClaim: "",
    });
  });

  it("keeps a role already chosen and drops the customer id claim for SSO", () => {
    expect(withSsoDefaults(DELEGATION, true)).toEqual({
      createAccounts: true,
      signInRole: IamRole.member,
      externalIdClaim: "",
    });
  });
});

describe("toSignInInput", () => {
  it("sends a delegation provider's customer id claim, trimmed", () => {
    expect(
      toSignInInput({ ...DELEGATION, externalIdClaim: "  org_id " }, false),
    ).toEqual({
      createAccountsOnSignIn: undefined,
      signInRole: IamRole.member,
      externalIdClaim: "org_id",
    });
  });

  it("never sends a customer id claim for an SSO provider", () => {
    expect(toSignInInput(DELEGATION, true).externalIdClaim).toBeUndefined();
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
        isSso={false}
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

  it("hides the customer id claim and locks account creation on for SSO", () => {
    render(
      <SignInSettingsSection
        isSso
        value={withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true)}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Customer id claim")).toBeNull();
    const toggle = screen.getByRole("switch", {
      name: "Create accounts on sign-in",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
  });
});
