"use client";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRoleSelector } from "./useRoleSelector.js";

/** Props for {@link RoleSelector}. */
export interface RoleSelectorProps {
  /** The resource kind whose grantable roles to display. */
  readonly kind: ApiResourceKind | null;
  /** Fired when the user selects a role. */
  readonly onSelect?: (role: IamRole) => void;
  /** Externally controlled selected role — makes this a controlled component. */
  readonly selected?: IamRole | null;
  /** Initial role to select (uncontrolled mode). */
  readonly defaultRole?: IamRole;
  /** Disable all role options. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Styled radio-group for selecting an IAM role.
 *
 * Displays all grantable roles for the given resource kind as
 * selectable pills, each showing the role name and description.
 *
 * For a headless alternative, use {@link useRoleSelector} directly.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <RoleSelector
 *   kind={ApiResourceKind.organization}
 *   onSelect={(role) => setRole(role)}
 * />
 * ```
 */
export function RoleSelector({
  kind,
  onSelect,
  selected: controlledSelected,
  defaultRole,
  disabled = false,
  className,
}: RoleSelectorProps) {
  const { options, selected: internalSelected, select } = useRoleSelector(
    kind,
    defaultRole,
  );

  const currentSelected = controlledSelected !== undefined
    ? controlledSelected
    : internalSelected;

  const handleSelect = (role: IamRole) => {
    select(role);
    onSelect?.(role);
  };

  if (options.length === 0) {
    return null;
  }

  return (
    <fieldset className={cn("stg:space-y-1.5", className)}>
      <legend className="stg:text-xs stg:font-medium stg:text-foreground">Role</legend>
      <div className="stg:flex stg:flex-wrap stg:gap-2">
        {options.map((opt) => {
          const isChecked = currentSelected === opt.role;
          return (
            <label
              key={opt.value}
              className={cn(
                "stg:inline-flex stg:cursor-pointer stg:flex-col stg:rounded-md stg:border stg:px-3 stg:py-1.5 stg:text-xs stg:transition-colors",
                isChecked
                  ? "stg:border-primary stg:bg-primary-subtle stg:text-primary stg:font-medium"
                  : "stg:border-input stg:bg-background stg:text-muted-foreground stg:hover:border-border stg:hover:text-foreground",
                disabled && "stg:pointer-events-none stg:opacity-50",
              )}
            >
              <input
                type="radio"
                name="stgm-role-selector"
                value={opt.value}
                checked={isChecked}
                disabled={disabled}
                onChange={() => handleSelect(opt.role)}
                className="stg:sr-only"
              />
              <span>{opt.label}</span>
              <span className="stg:text-[0.625rem] stg:text-muted-foreground stg:font-normal stg:mt-0.5">
                {opt.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
