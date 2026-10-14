"use client";

/**
 * The sign-in settings every identity-provider form asks for the same way:
 * whether a person's first sign-in creates their account, the role an
 * account receives the first time it signs in to an organization, and the
 * customer id claim: the token claim that names one of this organization's
 * child organizations by its external id.
 *
 * Every token a provider vouches for is bound to one organization: the
 * child the customer id claim names, otherwise the provider's own. The
 * sign-in role is granted once per account and organization, so a role an
 * admin removes later stays removed; "None" grants nothing, and the owner
 * role is never offered because ownership is assigned explicitly.
 */

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { FederationIssuerInput } from "@stigmer/sdk";
import type { FederationIssuerSpec } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";

/** The edit state of a provider's sign-in settings. */
export interface SignInSettings {
  readonly createAccounts: boolean;
  readonly signInRole: IamRole;
  readonly externalIdClaim: string;
}

/** A new provider's settings: no accounts created, no role granted, no claim. */
export const EMPTY_SIGN_IN_SETTINGS: SignInSettings = {
  createAccounts: false,
  signInRole: IamRole.iam_role_unspecified,
  externalIdClaim: "",
};

/** The edit state for a stored provider's spec. */
export function signInSettingsFromSpec(
  spec: FederationIssuerSpec | undefined,
): SignInSettings {
  return {
    createAccounts: spec?.createAccountsOnSignIn ?? false,
    signInRole: spec?.signInRole ?? IamRole.iam_role_unspecified,
    externalIdClaim: spec?.externalIdClaim ?? "",
  };
}


/**
 * The input fields for the settings. Unset values are `undefined`, so an
 * update that spreads a mapped input clears what the form cleared.
 */
export function toSignInInput(
  settings: SignInSettings,
): Pick<
  FederationIssuerInput,
  "createAccountsOnSignIn" | "signInRole" | "externalIdClaim"
> {
  const claim = settings.externalIdClaim.trim();
  return {
    createAccountsOnSignIn: settings.createAccounts ? true : undefined,
    signInRole:
      settings.signInRole !== IamRole.iam_role_unspecified
        ? settings.signInRole
        : undefined,
    externalIdClaim: claim ? claim : undefined,
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

const SIGN_IN_ROLE_OPTIONS: readonly {
  readonly value: IamRole;
  readonly label: string;
}[] = [
  { value: IamRole.iam_role_unspecified, label: "None" },
  { value: IamRole.viewer, label: "Viewer" },
  { value: IamRole.member, label: "Member" },
  { value: IamRole.admin, label: "Admin" },
];

/** Props for {@link SignInSettingsSection}. */
export interface SignInSettingsSectionProps {
  readonly value: SignInSettings;
  readonly onChange: (next: SignInSettings) => void;
  readonly disabled?: boolean;
}

/** The sign-in settings fieldset shared by the create, wizard and edit forms. */
export function SignInSettingsSection({
  value,
  onChange,
  disabled,
}: SignInSettingsSectionProps) {
  const baseId = useId();
  const roleHintId = `${baseId}-role-hint`;
  const claimHintId = `${baseId}-claim-hint`;

  return (
    <fieldset
      className={cn(UNSTYLED_FIELDSET, "stg:space-y-2.5")}
      disabled={disabled}
    >
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
            aria-checked={value.createAccounts}
            aria-label="Create accounts on sign-in"
            onClick={() =>
              onChange({ ...value, createAccounts: !value.createAccounts })
            }
            disabled={disabled}
            className={cn(
              "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:border-2 stg:border-transparent stg:transition-colors",
              value.createAccounts ? "stg:bg-primary" : "stg:bg-muted",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <span
              className={cn(
                "stg:pointer-events-none stg:inline-block stg:h-4 stg:w-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
                value.createAccounts ? "stg:translate-x-4" : "stg:translate-x-0",
              )}
            />
          </button>
          <span className="stg:text-xs stg:font-medium stg:text-foreground">
            Create accounts on sign-in
          </span>
        </div>
        <p className="stg:pl-11 stg:text-[0.65rem] stg:text-muted-foreground">
          Create a person&apos;s account from their token the first time
          they sign in. When off, accounts are created through the API before
          people can sign in
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
            onChange({
              ...value,
              signInRole: Number(e.target.value) as IamRole,
            })
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
            <option key={opt.value} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
        <p
          id={roleHintId}
          className="stg:text-[0.65rem] stg:text-muted-foreground"
        >
          Granted the first time someone signs in to the organization; None
          grants nothing. A role an admin removes later is not granted again.
        </p>
      </div>

      <div className="stg:space-y-1">
        <label
          htmlFor={`${baseId}-external-id-claim`}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Customer id claim
        </label>
        <input
          id={`${baseId}-external-id-claim`}
          type="text"
          value={value.externalIdClaim}
          onChange={(e) =>
            onChange({ ...value, externalIdClaim: e.target.value })
          }
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
        <p
          id={claimHintId}
          className="stg:text-[0.65rem] stg:text-muted-foreground"
        >
          Optional. The token claim that names one of this
          organization&apos;s child organizations by its external id: each
          token is bound to that child organization and works there only.
          When empty, tokens are bound to this provider&apos;s
          organization.
        </p>
      </div>
    </fieldset>
  );
}
