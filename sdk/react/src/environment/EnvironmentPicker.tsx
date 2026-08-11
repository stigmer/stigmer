"use client";

import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useEnvironmentList } from "./useEnvironmentList.js";

/** Props for {@link EnvironmentPicker}. */
export interface EnvironmentPickerProps {
  /** Organization slug to list environments from. */
  readonly org: string;
  /** Currently selected environment references, in merge order. */
  readonly value: readonly ResourceRef[];
  /** Called when the selection changes. */
  readonly onChange: (refs: ResourceRef[]) => void;
  /** Disable all interactions. */
  readonly disabled?: boolean;
  /**
   * Restrict which environments are offered in the dropdown. Already
   * selected references remain listed (and removable) even when they no
   * longer pass the filter — hiding them would strand the binding.
   * When omitted, every environment in the org is offered (the default
   * behavior of every existing caller).
   *
   * @example Only org-shared environments (guest-usable credentials):
   * ```tsx
   * filterEnvironment={(env) =>
   *   env.metadata?.visibility === ApiResourceVisibility.visibility_org
   * }
   * ```
   */
  readonly filterEnvironment?: (environment: Environment) => boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Multi-select component for binding Environment resources to an instance.
 *
 * Displays available environments as a dropdown and shows selected environments
 * as an ordered list with position numbers indicating merge priority.
 * Later entries override earlier ones when keys conflict.
 *
 * Uses `useEnvironmentList(org)` for data. Arrow buttons provide accessible
 * reordering without requiring drag-and-drop libraries.
 *
 * @example
 * ```tsx
 * <EnvironmentPicker
 *   org="acme"
 *   value={environmentRefs}
 *   onChange={setEnvironmentRefs}
 * />
 * ```
 */
export function EnvironmentPicker({
  org,
  value,
  onChange,
  disabled = false,
  filterEnvironment,
  className,
}: EnvironmentPickerProps) {
  const { environments, isLoading } = useEnvironmentList(org);
  const selectId = useId();

  const selectedSlugs = useMemo(
    () => new Set(value.map((ref) => ref.slug)),
    [value],
  );

  const availableEnvironments = useMemo(
    () =>
      environments.filter(
        (env) =>
          !selectedSlugs.has(env.metadata?.slug ?? "") &&
          (filterEnvironment?.(env) ?? true),
      ),
    [environments, selectedSlugs, filterEnvironment],
  );

  const handleAdd = useCallback(
    (slug: string) => {
      const env = environments.find((e) => e.metadata?.slug === slug);
      if (!env) return;

      const ref: ResourceRef = { org, slug: env.metadata!.slug };
      onChange([...value, ref]);
    },
    [environments, onChange, org, value],
  );

  const handleRemove = useCallback(
    (index: number) => {
      const next = [...value];
      next.splice(index, 1);
      onChange(next);
    },
    [onChange, value],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...value];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      onChange(next);
    },
    [onChange, value],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= value.length - 1) return;
      const next = [...value];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onChange(next);
    },
    [onChange, value],
  );

  const resolveEnvName = useCallback(
    (ref: ResourceRef): string => {
      const env = environments.find((e) => e.metadata?.slug === ref.slug);
      return env?.metadata?.name ?? ref.slug;
    },
    [environments],
  );

  const resolveEnvDescription = useCallback(
    (ref: ResourceRef): string => {
      const env = environments.find((e) => e.metadata?.slug === ref.slug);
      return env?.spec?.description ?? "";
    },
    [environments],
  );

  return (
    <div className={cn("stg:space-y-3", className)} role="group" aria-label="Environment bindings">
      {value.length > 0 && (
        <SelectedList
          value={value}
          disabled={disabled}
          resolveEnvName={resolveEnvName}
          resolveEnvDescription={resolveEnvDescription}
          onRemove={handleRemove}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          total={value.length}
        />
      )}

      {value.length > 1 && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Environments are merged in order. Later entries override earlier ones when keys conflict.
        </p>
      )}

      <div>
        <label htmlFor={selectId} className="stg:sr-only">
          Add environment
        </label>
        <select
          id={selectId}
          disabled={disabled || availableEnvironments.length === 0}
          value=""
          onChange={(e) => {
            if (e.target.value) handleAdd(e.target.value);
          }}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-3 stg:py-1.5 stg:text-sm",
            "stg:text-foreground stg:placeholder:text-muted-foreground",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
          )}
        >
          <option value="">
            {isLoading
              ? "Loading environments..."
              : availableEnvironments.length === 0
                ? value.length === environments.length && environments.length > 0
                  ? "All environments selected"
                  : "No environments available"
                : "+ Add environment"}
          </option>
          {availableEnvironments.map((env) => (
            <option key={env.metadata?.slug} value={env.metadata?.slug}>
              {env.metadata?.name ?? env.metadata?.slug}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface SelectedListProps {
  readonly value: readonly ResourceRef[];
  readonly disabled: boolean;
  readonly resolveEnvName: (ref: ResourceRef) => string;
  readonly resolveEnvDescription: (ref: ResourceRef) => string;
  readonly onRemove: (index: number) => void;
  readonly onMoveUp: (index: number) => void;
  readonly onMoveDown: (index: number) => void;
  readonly total: number;
}

function SelectedList({
  value,
  disabled,
  resolveEnvName,
  resolveEnvDescription,
  onRemove,
  onMoveUp,
  onMoveDown,
  total,
}: SelectedListProps) {
  return (
    <ol className="stg:space-y-1.5" aria-label="Selected environments (merge order)">
      {value.map((ref, index) => (
        <li
          key={`${ref.org}-${ref.slug}-${index}`}
          className={cn(
            "stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-border stg:px-3 stg:py-2",
            "stg:bg-muted/30",
          )}
        >
          <span className="stg:shrink-0 stg:w-5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:text-right">
            {index + 1}.
          </span>

          <div className="stg:flex-1 stg:min-w-0">
            <span className="stg:text-sm stg:font-medium stg:text-foreground stg:truncate stg:block">
              {resolveEnvName(ref)}
            </span>
            {resolveEnvDescription(ref) && (
              <span className="stg:text-[0.65rem] stg:text-muted-foreground stg:truncate stg:block">
                {resolveEnvDescription(ref)}
              </span>
            )}
          </div>

          {!disabled && (
            <div className="stg:flex stg:items-center stg:gap-0.5 stg:shrink-0">
              <ReorderButton
                direction="up"
                disabled={index === 0}
                onClick={() => onMoveUp(index)}
                label={`Move ${resolveEnvName(ref)} up`}
              />
              <ReorderButton
                direction="down"
                disabled={index === total - 1}
                onClick={() => onMoveDown(index)}
                label={`Move ${resolveEnvName(ref)} down`}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${resolveEnvName(ref)}`}
                className={cn(
                  "stg:rounded stg:p-1 stg:text-muted-foreground",
                  "stg:hover:text-destructive stg:hover:bg-destructive/10",
                  "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
                )}
              >
                <RemoveIcon />
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReorderButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  readonly direction: "up" | "down";
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "stg:rounded stg:p-1 stg:text-muted-foreground",
        "stg:hover:text-foreground stg:hover:bg-accent-hover",
        "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
        "stg:disabled:opacity-30 stg:disabled:cursor-not-allowed stg:disabled:hover:bg-transparent",
      )}
    >
      {direction === "up" ? <ArrowUpIcon /> : <ArrowDownIcon />}
    </button>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 9.5v-7M6 9.5L3 6.5M6 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
