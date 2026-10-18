"use client";

/**
 * The one Environment picker every surface that names an Environment uses:
 * an agent's default, a routine's, a new conversation's and the
 * organization's default.
 *
 * A single choice, as an agent picker is. Its first row is what applies
 * when the field is left empty ("Default: data-science (the agent's
 * default)", "Default: none", or "None" on the organization's own row,
 * where nothing further down the order exists), and choosing it clears the
 * field. There is no row that steps past an inherited Environment to none:
 * nobody chooses no Environment past the organization's default, and the
 * server has no value that would say so. The rows below it are the
 * Environments the caller can view; the server asks again, at save, whether
 * the writer may view the one named. A stored choice the caller cannot view
 * stays listed by its name, so the select never shows a value it does not
 * hold.
 */
import { useId, useMemo } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ResourceRef } from "@stigmer/client";
import { environmentName, useEnvironmentList } from "./useEnvironmentList.js";

/** Props for {@link EnvironmentPicker}. */
export interface EnvironmentPickerProps {
  /** Organization id to list Environments from (a slug is also accepted). */
  readonly org: string;
  /** The field's own choice, or `undefined` when it is left to the default. */
  readonly value: ResourceRef | undefined;
  /** Called with the chosen Environment, or `undefined` when the default row is chosen. */
  readonly onChange: (ref: ResourceRef | undefined) => void;
  /**
   * The first row's words: what applies when the field is left empty
   * (`inheritedRowLabel`).
   * @default "Default: none"
   */
  readonly defaultLabel?: string;
  /** Accessible name of the select. @default "Environment" */
  readonly label?: string;
  /** Show the label above the select. @default false */
  readonly showLabel?: boolean;
  /** Disable the select. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Single-select for naming an Environment on a surface.
 *
 * @example
 * ```tsx
 * <EnvironmentPicker
 *   org="acme"
 *   value={environmentRef}
 *   onChange={setEnvironmentRef}
 *   defaultLabel={inheritedRowLabel(inherited)}
 * />
 * ```
 */
export function EnvironmentPicker({
  org,
  value,
  onChange,
  defaultLabel = "Default: none",
  label = "Environment",
  showLabel = false,
  disabled = false,
  className,
}: EnvironmentPickerProps) {
  const { environments, isLoading } = useEnvironmentList(org);
  const selectId = useId();

  const rows = useMemo(() => {
    const listed = environments.map((environment) => ({
      org: environment.metadata?.org ?? org,
      slug: environment.metadata?.slug ?? "",
      name: environmentName(environment),
    }));
    const held = value?.slug ?? "";
    if (held !== "" && !listed.some((row) => row.slug === held)) {
      listed.push({ org: value?.org ?? org, slug: held, name: held });
    }
    return listed;
  }, [environments, org, value]);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-1", className)}>
      <label
        htmlFor={selectId}
        className={showLabel ? "stg:text-xs stg:font-medium stg:text-muted-foreground" : "stg:sr-only"}
      >
        {label}
      </label>
      <select
        id={selectId}
        disabled={disabled}
        value={value?.slug ?? ""}
        onChange={(event) => {
          const row = rows.find((candidate) => candidate.slug === event.target.value);
          onChange(row === undefined ? undefined : { org: row.org, slug: row.slug });
        }}
        className={cn(
          "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-3 stg:py-1.5 stg:text-sm",
          "stg:text-foreground",
          "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
          "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
        )}
      >
        <option value="">{defaultLabel}</option>
        {rows.map((row) => (
          <option key={row.slug} value={row.slug}>
            {row.name}
          </option>
        ))}
        {isLoading && rows.length === 0 && (
          <option value="" disabled>
            Loading environments...
          </option>
        )}
      </select>
    </div>
  );
}
