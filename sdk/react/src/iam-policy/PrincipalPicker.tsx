"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { getUserMessage } from "@stigmer/sdk";
import { useResourceAccess } from "./useResourceAccess.js";
import { ProviderBadge, providerLabel } from "./ProviderBadge.js";

/** A principal selected through {@link PrincipalPicker}. */
export interface SelectedPrincipal {
  /** identity_account ID (`ida_...`). */
  readonly id: string;
  /** Display name (falls back to email, then ID). */
  readonly name: string;
  /** Email address, if known. */
  readonly email: string;
  /** Full view for richer rendering (avatar, provider). */
  readonly view: ApiResourceRefView;
}

/** Props for {@link PrincipalPicker}. */
export interface PrincipalPickerProps {
  /** Organization whose members are selectable. */
  readonly orgId: string;
  /** Currently selected principal, or `null`. Controlled. */
  readonly value: SelectedPrincipal | null;
  /** Fired when the selection changes. */
  readonly onChange: (principal: SelectedPrincipal | null) => void;
  /** Principal IDs to hide/disable because they already have access. */
  readonly excludePrincipalIds?: readonly string[];
  /** Disable the control. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Accessible combobox for picking an organization member to share with.
 *
 * Replaces raw account-ID entry: users type a name or email and choose a
 * person from the org's member list. Because email is not unique across
 * identity sources, each candidate shows a {@link ProviderBadge} so accounts
 * that share an email (e.g. a direct account and a federated one) can be told
 * apart. The resolved `identity_account` ID is carried internally — the user
 * never sees it.
 *
 * Members who already have access are shown disabled, so the same person is
 * not granted twice.
 *
 * Search is over the org member list the caller can already see
 * (`listResourceAccessByPrincipal` on the organization), so it introduces no
 * new account-enumeration surface.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function PrincipalPicker({
  orgId,
  value,
  onChange,
  excludePrincipalIds,
  disabled = false,
  className,
}: PrincipalPickerProps) {
  const listboxId = useId();
  const { members, isLoading, error } = useResourceAccess(
    orgId ? { kind: "organization", id: orgId } : null,
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const excluded = useMemo(
    () => new Set(excludePrincipalIds ?? []),
    [excludePrincipalIds],
  );

  // Org members that are identity accounts, deduped by ID. The org list groups
  // by principal, so each ID appears once already; the dedupe guards against
  // inherited-role duplicates.
  const candidates = useMemo(() => {
    const byId = new Map<string, ApiResourceRefView>();
    for (const entry of members) {
      const p = entry.principal;
      if (!p || p.kind !== "identity_account" || !p.id) continue;
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [members]);

  // Emails that appear on more than one candidate — these are the rows where
  // the provider badge is doing real disambiguation work.
  const duplicatedEmails = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) {
      const email = c.email?.toLowerCase();
      if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([email]) => email),
    );
  }, [candidates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const email = (c.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [candidates, query]);

  const commitSelection = useCallback(
    (view: ApiResourceRefView) => {
      if (excluded.has(view.id)) return;
      onChange({
        id: view.id,
        name: view.name || view.email || view.id,
        email: view.email,
        view,
      });
      setQuery("");
      setOpen(false);
    },
    [excluded, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const choice = filtered[activeIndex];
        if (choice && !excluded.has(choice.id)) commitSelection(choice);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [filtered, activeIndex, excluded, commitSelection],
  );

  // Selected state: show a chip with a clear affordance instead of the input.
  if (value) {
    return (
      <div className={cn("stg:space-y-1", className)}>
        <span className="stg:block stg:text-xs stg:font-medium stg:text-foreground">Person</span>
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5">
          <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
            <div
              className="stg:flex stg:h-6 stg:w-6 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-[0.6rem] stg:font-medium stg:text-muted-foreground"
              aria-hidden="true"
            >
              {(value.name[0] ?? "?").toUpperCase()}
            </div>
            <div className="stg:min-w-0">
              <div className="stg:flex stg:items-center stg:gap-1.5">
                <span className="stg:truncate stg:text-xs stg:text-foreground">{value.name}</span>
                <ProviderBadge principal={value.view} />
              </div>
              {value.email && value.email !== value.name && (
                <span className="stg:block stg:truncate stg:text-[0.6rem] stg:text-muted-foreground">
                  {value.email}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Clear selected person"
            className={cn(
              "stg:shrink-0 stg:rounded stg:p-0.5 stg:text-muted-foreground",
              "stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <ClearIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-1", className)}>
      <label
        htmlFor={`${listboxId}-input`}
        className="stg:block stg:text-xs stg:font-medium stg:text-foreground"
      >
        Person
      </label>
      <div className="stg:relative">
        <input
          id={`${listboxId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so option mousedown can register before close.
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search by name or email"
          disabled={disabled || isLoading}
          autoFocus
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />

        {open && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Organization members"
            className={cn(
              UNSTYLED_LIST,
              "stg:absolute stg:z-10 stg:mt-1 stg:max-h-56 stg:w-full stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-popover stg:py-1 stg:shadow-md",
            )}
          >
            {isLoading && (
              <li className="stg:px-2.5 stg:py-2 stg:text-xs stg:text-muted-foreground">
                Loading members…
              </li>
            )}

            {!isLoading && error && (
              <li className="stg:px-2.5 stg:py-2 stg:text-[0.65rem] stg:text-destructive" role="alert">
                {getUserMessage(error)}
              </li>
            )}

            {!isLoading && !error && filtered.length === 0 && (
              <li className="stg:px-2.5 stg:py-2 stg:text-xs stg:text-muted-foreground">
                {query.trim()
                  ? "No members match your search."
                  : "No members to share with."}
              </li>
            )}

            {!isLoading &&
              !error &&
              filtered.map((c, index) => {
                const isExcluded = excluded.has(c.id);
                const isActive = index === activeIndex;
                const name = c.name || c.email || c.id;
                // Show the provider badge when it disambiguates: an external
                // identity source, or a shared email across candidates.
                const showBadge =
                  !!providerLabel(c) &&
                  (c.identityOrigin?.providerDisplayName !== "Stigmer" ||
                    (!!c.email && duplicatedEmails.has(c.email.toLowerCase())));
                return (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={isExcluded}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => {
                      // Prevent input blur before selection commits.
                      e.preventDefault();
                      if (!isExcluded) commitSelection(c);
                    }}
                    className={cn(
                      "stg:flex stg:items-center stg:justify-between stg:gap-2 stg:px-2.5 stg:py-1.5",
                      isExcluded
                        ? "stg:cursor-not-allowed stg:opacity-50"
                        : "stg:cursor-pointer",
                      isActive && !isExcluded && "stg:bg-accent-hover",
                    )}
                  >
                    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
                      <div
                        className="stg:flex stg:h-6 stg:w-6 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-[0.6rem] stg:font-medium stg:text-muted-foreground"
                        aria-hidden="true"
                      >
                        {(name[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="stg:min-w-0">
                        <div className="stg:flex stg:items-center stg:gap-1.5">
                          <span className="stg:truncate stg:text-xs stg:text-foreground">
                            {name}
                          </span>
                          {showBadge && <ProviderBadge principal={c} />}
                        </div>
                        {c.email && c.email !== name && (
                          <span className="stg:block stg:truncate stg:text-[0.6rem] stg:text-muted-foreground">
                            {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExcluded && (
                      <span className="stg:shrink-0 stg:text-[0.6rem] stg:text-muted-foreground">
                        Has access
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ClearIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
