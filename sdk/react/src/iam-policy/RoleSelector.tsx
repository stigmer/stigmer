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
    <fieldset className={cn("space-y-1.5", className)}>
      <legend className="text-xs font-medium text-foreground">Role</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isChecked = currentSelected === opt.role;
          return (
            <label
              key={opt.value}
              title={opt.description}
              className={cn(
                "inline-flex cursor-pointer flex-col rounded-md border px-3 py-1.5 text-xs transition-colors",
                isChecked
                  ? "border-primary bg-primary-subtle text-primary font-medium"
                  : "border-input bg-background text-muted-foreground hover:border-border hover:text-foreground",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <input
                type="radio"
                name="stgm-role-selector"
                value={opt.value}
                checked={isChecked}
                disabled={disabled}
                onChange={() => handleSelect(opt.role)}
                className="sr-only"
              />
              <span>{opt.label}</span>
              <span className="text-[0.625rem] text-muted-foreground font-normal mt-0.5">
                {opt.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
