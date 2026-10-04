"use client";

/**
 * The sign-in settings every identity-provider form asks for the same way:
 * whether a person's first sign-in creates their account, the role an
 * account receives the first time it signs in to an organization, and the
 * token claim that names the organization a token works in.
 *
 * Every token a provider vouches for is bound to one organization: the one
 * the tenant claim names, otherwise the provider's own. The sign-in role is
 * granted once per account and organization, so a role an admin removes
 * later stays removed; "None" grants nothing, and the owner role is never
 * offered because ownership is assigned explicitly.
 *
 * An SSO provider must create accounts and grant a role, so turning SSO on
 * locks account creation on and fills an unset role with viewer; the
 * forms refuse to submit an SSO provider without both.
 */

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { IdentityProviderInput } from "@stigmer/sdk";
import type { IdentityProviderSpec } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";

/** The edit state of a provider's sign-in settings. */
export interface SignInSettings {
  readonly createAccounts: boolean;
  readonly signInRole: IamRole;
  readonly tenantOrgClaim: string;
}

/** A new provider's settings: no accounts created, no role granted, no claim. */
export const EMPTY_SIGN_IN_SETTINGS: SignInSettings = {
  createAccounts: false,
  signInRole: IamRole.iam_role_unspecified,
  tenantOrgClaim: "",
};

/** The edit state for a stored provider's spec. */
export function signInSettingsFromSpec(
  spec: IdentityProviderSpec | undefined,
): SignInSettings {
  return {
    createAccounts: spec?.createAccountsOnSignIn ?? false,
    signInRole: spec?.signInRole ?? IamRole.iam_role_unspecified,
    tenantOrgClaim: spec?.tenantOrgClaim ?? "",
  };
}

/**
 * The settings an SSO provider starts from: account creation on, and
 * viewer when no role is chosen yet. A non-SSO provider's settings are
 * returned unchanged.
 */
export function withSsoDefaults(
  settings: SignInSettings,
  isSso: boolean,
): SignInSettings {
  if (!isSso) return settings;
  return {
    ...settings,
    createAccounts: true,
    signInRole:
      settings.signInRole === IamRole.iam_role_unspecified
        ? IamRole.viewer
        : settings.signInRole,
  };
}

/** Whether the settings satisfy the provider kind: an SSO provider needs a role. */
export function signInSettingsComplete(
  settings: SignInSettings,
  isSso: boolean,
): boolean {
  return !isSso || settings.signInRole !== IamRole.iam_role_unspecified;
}

/**
 * The input fields for the settings. Unset values are `undefined`, so an
 * update that spreads a mapped input clears what the form cleared.
 */
export function toSignInInput(
  settings: SignInSettings,
  isSso: boolean,
): Pick<
  IdentityProviderInput,
  "createAccountsOnSignIn" | "signInRole" | "tenantOrgClaim"
> {
  const claim = settings.tenantOrgClaim.trim();
  return {
    createAccountsOnSignIn: isSso || settings.createAccounts ? true : undefined,
    signInRole:
      settings.signInRole !== IamRole.iam_role_unspecified
        ? settings.signInRole
        : undefined,
    tenantOrgClaim: claim || undefined,
  };
}

/** The display name of a sign-in role; unspecified reads as "None". */
export function formatSignInRole(role: IamRole): string {
  switch (role) {
    case IamRole.viewer:
      return "Viewer";
    case IamRole.member:
      return "Member";
    case IamRole.admin:
      return "Admin";
    case IamRole.owner:
      return "Owner";
    default:
      return "None";
  }
}

const SIGN_IN_ROLE_OPTIONS: readonly { readonly value: IamRole; readonly label: string }[] = [
  { value: IamRole.iam_role_unspecified, label: "None" },
  { value: IamRole.viewer, label: "Viewer" },
  { value: IamRole.member, label: "Member" },
  { value: IamRole.admin, label: "Admin" },
];

/** Props for {@link SignInSettingsSection}. */
export interface SignInSettingsSectionProps {
  readonly isSso: boolean;
  readonly value: SignInSettings;
  readonly onChange: (next: SignInSettings) => void;
  readonly disabled?: boolean;
}

/** The sign-in settings fieldset shared by the create, wizard and edit forms. */
export function SignInSettingsSection({
  isSso,
  value,
  onChange,
  disabled,
}: SignInSettingsSectionProps) {
  const baseId = useId();
  const roleHintId = `${baseId}-role-hint`;
  const claimHintId = `${baseId}-claim-hint`;

  return (
    <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2.5")} disabled={disabled}>
      <hr className="stg:border-border-muted" />
      <legend className="stg:text-xs stg:font-medium stg:text-foreground">
        Sign-in
      </legend>
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        What happens when someone signs in with a token from this provider.
      </p>

      <div className="stg:space-y-0.5">
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isSso || value.createAccounts}
            aria-label="Create accounts on sign-in"
            onClick={() => onChange({ ...value, createAccounts: !value.createAccounts })}
            disabled={disabled || isSso}
            className={cn(
              "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:border-2 stg:border-transparent stg:transition-colors",
              isSso || value.createAccounts ? "stg:bg-primary" : "stg:bg-muted",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <span
              className={cn(
                "stg:pointer-events-none stg:inline-block stg:h-4 stg:w-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
                isSso || value.createAccounts ? "stg:translate-x-4" : "stg:translate-x-0",
              )}
            />
          </button>
          <span className="stg:text-xs stg:font-medium stg:text-foreground">
            Create accounts on sign-in
          </span>
        </div>
        <p className="stg:pl-11 stg:text-[0.65rem] stg:text-muted-foreground">
          {isSso
            ? "Always on for an SSO provider"
            : "Create a person's account from their token the first time they sign in. When off, accounts are created through the API before people can sign in"}
        </p>
      </div>

      <div className="stg:space-y-1">
        <label
          htmlFor={`${baseId}-role`}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Sign-in role
        </label>
        <select
          id={`${baseId}-role`}
          value={String(value.signInRole)}
          onChange={(e) =>
            onChange({ ...value, signInRole: Number(e.target.value) as IamRole })
          }
          disabled={disabled}
          aria-describedby={roleHintId}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {SIGN_IN_ROLE_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={String(opt.value)}
              disabled={isSso && opt.value === IamRole.iam_role_unspecified}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <p id={roleHintId} className="stg:text-[0.65rem] stg:text-muted-foreground">
          {isSso
            ? "Granted the first time someone signs in to the organization; an SSO provider must grant one. A role an admin removes later is not granted again."
            : "Granted the first time someone signs in to the organization; None grants nothing. A role an admin removes later is not granted again."}
        </p>
      </div>

      <div className="stg:space-y-1">
        <label
          htmlFor={`${baseId}-tenant-claim`}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Tenant org claim
        </label>
        <input
          id={`${baseId}-tenant-claim`}
          type="text"
          value={value.tenantOrgClaim}
          onChange={(e) => onChange({ ...value, tenantOrgClaim: e.target.value })}
          placeholder="e.g., org_id"
          disabled={disabled}
          maxLength={256}
          aria-describedby={claimHintId}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <p id={claimHintId} className="stg:text-[0.65rem] stg:text-muted-foreground">
          Optional. The token claim that names a platform-managed organization:
          each token is bound to the claimed organization and works there only.
          When empty, tokens are bound to this provider&apos;s organization.
        </p>
      </div>
    </fieldset>
  );
}
