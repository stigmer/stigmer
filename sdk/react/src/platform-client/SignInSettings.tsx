"use client";

/**
 * The sign-in settings the platform-client create and edit forms ask for
 * the same way: whether minting a token for an unknown user creates their
 * account, and the role that account receives on the client's organization.
 *
 * Every user token a client mints works in the client's organization only.
 * The sign-in role is granted once, when the client creates the account,
 * so it requires account creation; "None" grants nothing, and the owner
 * role is never offered because ownership is assigned explicitly.
 */

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { PlatformClientInput } from "@stigmer/sdk";
import type { PlatformClientSpec } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";

/** The edit state of a client's sign-in settings. */
export interface ClientSignInSettings {
  readonly createAccounts: boolean;
  readonly signInRole: IamRole;
}

/** The edit state for a stored client's spec. */
export function clientSignInSettingsFromSpec(
  spec: PlatformClientSpec | undefined,
): ClientSignInSettings {
  return {
    createAccounts: spec?.createAccountsOnSignIn ?? false,
    signInRole: spec?.signInRole ?? IamRole.iam_role_unspecified,
  };
}

/**
 * The input fields for the settings. Unset values are `undefined`, so an
 * update that spreads a mapped input clears what the form cleared; a role
 * never travels without account creation.
 */
export function toClientSignInInput(
  settings: ClientSignInSettings,
): Pick<PlatformClientInput, "createAccountsOnSignIn" | "signInRole"> {
  return {
    createAccountsOnSignIn: settings.createAccounts ? true : undefined,
    signInRole:
      settings.createAccounts &&
      settings.signInRole !== IamRole.iam_role_unspecified
        ? settings.signInRole
        : undefined,
  };
}

/** The display name of a sign-in role; unspecified reads as "None". */
export function formatClientSignInRole(role: IamRole): string {
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

/** Props for {@link ClientSignInSettingsSection}. */
export interface ClientSignInSettingsSectionProps {
  readonly value: ClientSignInSettings;
  readonly onChange: (next: ClientSignInSettings) => void;
  readonly disabled?: boolean;
}

/** The sign-in settings fieldset shared by the create and edit forms. */
export function ClientSignInSettingsSection({
  value,
  onChange,
  disabled,
}: ClientSignInSettingsSectionProps) {
  const baseId = useId();
  const roleHintId = `${baseId}-role-hint`;

  const toggleCreateAccounts = () => {
    const next = !value.createAccounts;
    onChange({
      createAccounts: next,
      signInRole: next ? value.signInRole : IamRole.iam_role_unspecified,
    });
  };

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
        What happens when this client mints a token for one of your users. Every
        token it mints works in this organization only.
      </p>

      <div className="stg:space-y-0.5">
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={value.createAccounts}
            aria-label="Create accounts on sign-in"
            onClick={toggleCreateAccounts}
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
                value.createAccounts
                  ? "stg:translate-x-4"
                  : "stg:translate-x-0",
              )}
            />
          </button>
          <span className="stg:text-xs stg:font-medium stg:text-foreground">
            Create accounts on sign-in
          </span>
        </div>
        <p className="stg:pl-11 stg:text-[0.65rem] stg:text-muted-foreground">
          Create a user&apos;s Stigmer account the first time the client mints a
          token for them. When off, accounts are created before minting
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
          disabled={disabled || !value.createAccounts}
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
          Granted on this organization when the client creates an account; None
          grants nothing. Accounts that already exist keep their roles.
        </p>
      </div>
    </fieldset>
  );
}
