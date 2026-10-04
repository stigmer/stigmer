/**
 * Pins the identity-provider sign-in settings every provider form shares:
 *
 *   - turning SSO on starts from account creation on, viewer when no role
 *     is chosen, and no tenant claim; turning it off changes nothing the
 *     admin chose;
 *   - an SSO provider never sends a tenant claim, because the claim names
 *     platform-managed organizations, which only a delegation provider
 *     manages; the section hides the field for SSO;
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
  withSsoDefaults,
  type SignInSettings,
} from "../SignInSettings";

afterEach(cleanup);

const DELEGATION: SignInSettings = {
  createAccounts: false,
  signInRole: IamRole.member,
  tenantOrgClaim: "org_id",
};

describe("withSsoDefaults", () => {
  it("leaves a non-SSO provider's settings as the admin chose them", () => {
    expect(withSsoDefaults(DELEGATION, false)).toBe(DELEGATION);
  });

  it("starts an SSO provider with account creation, viewer and no tenant claim", () => {
    expect(withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true)).toEqual({
      createAccounts: true,
      signInRole: IamRole.viewer,
      tenantOrgClaim: "",
    });
  });

  it("keeps a role already chosen and drops the tenant claim for SSO", () => {
    expect(withSsoDefaults(DELEGATION, true)).toEqual({
      createAccounts: true,
      signInRole: IamRole.member,
      tenantOrgClaim: "",
    });
  });
});

describe("toSignInInput", () => {
  it("sends a delegation provider's tenant claim, trimmed", () => {
    expect(
      toSignInInput({ ...DELEGATION, tenantOrgClaim: "  org_id " }, false),
    ).toEqual({
      createAccountsOnSignIn: undefined,
      signInRole: IamRole.member,
      tenantOrgClaim: "org_id",
    });
  });

  it("never sends a tenant claim for an SSO provider", () => {
    expect(toSignInInput(DELEGATION, true).tenantOrgClaim).toBeUndefined();
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
  it("reports the create-accounts toggle and the tenant claim the admin sets", () => {
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

    fireEvent.change(screen.getByLabelText("Tenant org claim"), {
      target: { value: "org_id" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_SIGN_IN_SETTINGS,
      tenantOrgClaim: "org_id",
    });
  });

  it("hides the tenant claim and locks account creation on for SSO", () => {
    render(
      <SignInSettingsSection
        isSso
        value={withSsoDefaults(EMPTY_SIGN_IN_SETTINGS, true)}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Tenant org claim")).toBeNull();
    const toggle = screen.getByRole("switch", {
      name: "Create accounts on sign-in",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
  });
});
