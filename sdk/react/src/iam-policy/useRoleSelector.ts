"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import {
  getGrantableRoles,
  iamRoleDisplayName,
  iamRoleDescription,
  iamRoleToString,
} from "@stigmer/sdk";

/** A single role option with display metadata. */
export interface RoleOption {
  /** The IamRole enum value. */
  readonly role: IamRole;
  /** Human-readable display name (e.g. "Admin"). */
  readonly label: string;
  /** Short description suitable for tooltips (e.g. "Edit access and member management"). */
  readonly description: string;
  /** The FGA relation string (e.g. "admin"). */
  readonly value: string;
}

/** Return value of {@link useRoleSelector}. */
export interface UseRoleSelectorReturn {
  /** Available role options for the given resource kind. */
  readonly options: readonly RoleOption[];
  /** Currently selected role, or `null` if nothing is selected. */
  readonly selected: IamRole | null;
  /** FGA relation string for the selected role, or `""` if nothing is selected. */
  readonly selectedValue: string;
  /** Select a role. */
  readonly select: (role: IamRole) => void;
  /** Clear the selection. */
  readonly clear: () => void;
  /** Whether at least one role option exists. */
  readonly hasOptions: boolean;
}

/**
 * Headless hook for selecting an IAM role for a given resource kind.
 *
 * Provides role options with display metadata (label, description,
 * FGA relation string) and selection state. Use this directly if you
 * need a custom role picker UI; for the styled version, use
 * {@link RoleSelector}.
 *
 * @param kind - The resource kind to show grantable roles for, or `null`.
 * @param defaultRole - Optional initial selection.
 *
 * @example
 * ```tsx
 * const { options, selected, select } = useRoleSelector(ApiResourceKind.organization);
 *
 * options.map(opt => (
 *   <button key={opt.value} onClick={() => select(opt.role)}>
 *     {opt.label} — {opt.description}
 *   </button>
 * ));
 * ```
 */
export function useRoleSelector(
  kind: ApiResourceKind | null,
  defaultRole?: IamRole,
): UseRoleSelectorReturn {
  const [selected, setSelected] = useState<IamRole | null>(
    defaultRole ?? null,
  );

  const options = useMemo<readonly RoleOption[]>(() => {
    if (kind === null) return [];
    return getGrantableRoles(kind).map((role) => ({
      role,
      label: iamRoleDisplayName(role),
      description: iamRoleDescription(role),
      value: iamRoleToString(role),
    }));
  }, [kind]);

  const selectedValue = useMemo(
    () => (selected !== null ? iamRoleToString(selected) : ""),
    [selected],
  );

  const select = useCallback((role: IamRole) => setSelected(role), []);
  const clear = useCallback(() => setSelected(null), []);

  return {
    options,
    selected,
    selectedValue,
    select,
    clear,
    hasOptions: options.length > 0,
  };
}
