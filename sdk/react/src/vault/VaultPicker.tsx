"use client";

/**
 * The ordered vault picker every surface that names vaults uses: a share, a
 * channel, a schedule, a platform client, an agent and a conversation.
 *
 * Order matters: the first vault holding a match wins. My vault is offered
 * only where the surface may name it (a schedule its owner sets up, through
 * `allowMyVault`): a conversation, an agent, a share, a channel and a
 * platform client refuse it on the server, and the picker never offers what
 * the server refuses. The vaults offered are those the caller can see; the
 * server asks again, at save and at every run, whether they may be used.
 */
import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { isMyVault, useVaultList } from "./useVaultList.js";

/** The name My vault is shown with. */
export const MY_VAULT_LABEL = "My vault";

/** Props for {@link VaultPicker}. */
export interface VaultPickerProps {
  /** Organization id to list vaults from (a slug is also accepted). */
  readonly org: string;
  /** Currently selected vault references, in order (the first match wins). */
  readonly value: readonly ResourceRef[];
  /** Called when the selection changes. */
  readonly onChange: (refs: ResourceRef[]) => void;
  /** Disable all interactions. */
  readonly disabled?: boolean;
  /**
   * Offer the caller's own My vault. Only a schedule its owner sets up may
   * name it; every other surface leaves this off.
   */
  readonly allowMyVault?: boolean;
  /**
   * Restrict which shared vaults are offered. Already selected references
   * stay listed (and removable) even when they no longer pass the filter.
   */
  readonly filterVault?: (vault: Vault) => boolean;
  /** A line shown under the picker while at least one vault is picked. */
  readonly selectionNote?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

function vaultLabel(vault: Vault): string {
  return isMyVault(vault) ? MY_VAULT_LABEL : (vault.metadata?.name ?? vault.metadata?.slug ?? "");
}

/**
 * Multi-select for naming vaults on a surface, as an ordered list with
 * accessible reorder buttons.
 *
 * @example
 * ```tsx
 * <VaultPicker org="acme" value={vaults} onChange={setVaults} />
 * ```
 */
export function VaultPicker({
  org,
  value,
  onChange,
  disabled = false,
  allowMyVault = false,
  filterVault,
  selectionNote,
  className,
}: VaultPickerProps) {
  const { vaults, isLoading } = useVaultList(org);
  const selectId = useId();

  const offerable = useMemo(
    () =>
      vaults.filter((vault) =>
        isMyVault(vault) ? allowMyVault : (filterVault?.(vault) ?? true),
      ),
    [vaults, allowMyVault, filterVault],
  );

  const selectedSlugs = useMemo(
    () => new Set(value.map((ref) => ref.slug)),
    [value],
  );

  const available = useMemo(
    () => offerable.filter((v) => !selectedSlugs.has(v.metadata?.slug ?? "")),
    [offerable, selectedSlugs],
  );

  // Called only with a slug the picker offered (one of `available`).
  const handleAdd = useCallback(
    (slug: string) => {
      onChange([...value, { org, slug }]);
    },
    [onChange, org, value],
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

  const resolveName = useCallback(
    (ref: ResourceRef): string => {
      const vault = vaults.find((v) => v.metadata?.slug === ref.slug);
      return vault ? vaultLabel(vault) : ref.slug;
    },
    [vaults],
  );

  const resolveDescription = useCallback(
    (ref: ResourceRef): string => {
      const vault = vaults.find((v) => v.metadata?.slug === ref.slug);
      return vault?.spec?.description ?? "";
    },
    [vaults],
  );

  return (
    <div className={cn("stg:space-y-3", className)} role="group" aria-label="Vaults">
      {value.length > 0 && (
        <SelectedList
          value={value}
          disabled={disabled}
          resolveName={resolveName}
          resolveDescription={resolveDescription}
          onRemove={handleRemove}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          total={value.length}
        />
      )}

      {value.length > 1 && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Vaults are read in order: the first one holding a key or a login wins.
        </p>
      )}

      {value.length > 0 && selectionNote && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">{selectionNote}</p>
      )}

      <div>
        <label htmlFor={selectId} className="stg:sr-only">
          Add vault
        </label>
        <select
          id={selectId}
          disabled={disabled || available.length === 0}
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
              ? "Loading vaults..."
              : available.length === 0
                ? value.length > 0 && offerable.length > 0
                  ? "All vaults selected"
                  : "No vaults available"
                : "+ Add vault"}
          </option>
          {available.map((vault) => (
            <option key={vault.metadata?.slug} value={vault.metadata?.slug}>
              {vaultLabel(vault)}
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
  readonly resolveName: (ref: ResourceRef) => string;
  readonly resolveDescription: (ref: ResourceRef) => string;
  readonly onRemove: (index: number) => void;
  readonly onMoveUp: (index: number) => void;
  readonly onMoveDown: (index: number) => void;
  readonly total: number;
}

function SelectedList({
  value,
  disabled,
  resolveName,
  resolveDescription,
  onRemove,
  onMoveUp,
  onMoveDown,
  total,
}: SelectedListProps) {
  return (
    <ol className={cn(UNSTYLED_LIST, "stg:space-y-1.5")} aria-label="Selected vaults (in order)">
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
              {resolveName(ref)}
            </span>
            {resolveDescription(ref) && (
              <span className="stg:text-[0.65rem] stg:text-muted-foreground stg:truncate stg:block">
                {resolveDescription(ref)}
              </span>
            )}
          </div>

          {!disabled && (
            <div className="stg:flex stg:items-center stg:gap-0.5 stg:shrink-0">
              <ReorderButton
                direction="up"
                disabled={index === 0}
                onClick={() => onMoveUp(index)}
                label={`Move ${resolveName(ref)} up`}
              />
              <ReorderButton
                direction="down"
                disabled={index === total - 1}
                onClick={() => onMoveDown(index)}
                label={`Move ${resolveName(ref)} down`}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${resolveName(ref)}`}
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
