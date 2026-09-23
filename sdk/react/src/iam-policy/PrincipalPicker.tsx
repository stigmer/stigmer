"use client";

/**
 * The share picker: an accessible combobox for choosing who a resource is
 * shared with, a person from the organization or, where the resource can
 * be shared with teams, one of the organization's teams.
 *
 * Users type a name, an email or a team name; the resolved grantee is
 * carried internally and never shown. Because email is not unique across
 * identity sources, a person shows a {@link ProviderBadge} when it
 * disambiguates. With teams offered, results come in two labelled groups,
 * People then Teams, and the arrow keys walk both as one list.
 *
 * Grantees that already have access show disabled, so no one is granted
 * twice. Candidates come from lists the caller can already see
 * ({@link useGranteeCandidates}), so the picker opens no new enumeration
 * surface.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, granteeKey, type Grantee } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { GranteeAvatar } from "./GranteeAvatar.js";
import { ProviderBadge, providerLabel } from "./ProviderBadge.js";
import {
  useGranteeCandidates,
  type GranteeCandidate,
  type PersonCandidate,
} from "./useGranteeCandidates.js";

/** A grantee selected through {@link PrincipalPicker}. */
export type SelectedGrantee = GranteeCandidate;

/** Props for {@link PrincipalPicker}. */
export interface PrincipalPickerProps {
  /** Organization whose people (and teams) are selectable. */
  readonly orgId: string;
  /** Currently selected grantee, or `null`. Controlled. */
  readonly value: SelectedGrantee | null;
  /** Fired when the selection changes. */
  readonly onChange: (grantee: SelectedGrantee | null) => void;
  /**
   * Offer the organization's teams beside its people. Set it where the
   * resource can be shared with a team (`useShareFlow().canShareWithTeams`).
   */
  readonly includeTeams?: boolean;
  /** Grantees shown disabled because they already have access. */
  readonly excludeGrantees?: readonly Grantee[];
  /** Disable the control. */
  readonly disabled?: boolean;
  /**
   * Focus the search input on mount. Right where the picker opens on a
   * deliberate click (the grant form); turn it off where the picker is
   * always on screen, or it takes focus from the rest of the page.
   */
  readonly autoFocus?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Accessible combobox for picking a person or a team to share with.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function PrincipalPicker({
  orgId,
  value,
  onChange,
  includeTeams = false,
  excludeGrantees,
  disabled = false,
  autoFocus = true,
  className,
}: PrincipalPickerProps) {
  const listboxId = useId();
  const { people, teams, isLoading, error } = useGranteeCandidates({
    orgId: orgId || null,
    includeTeams,
  });

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const excluded = useMemo(
    () => new Set((excludeGrantees ?? []).map(granteeKey)),
    [excludeGrantees],
  );
  const isExcluded = useCallback(
    (candidate: GranteeCandidate) => excluded.has(granteeKey(candidate.grantee)),
    [excluded],
  );

  // Emails that appear on more than one person — the rows where the
  // provider badge does real disambiguation work.
  const duplicatedEmails = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) {
      const email = person.email.toLowerCase();
      if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([email]) => email));
  }, [people]);

  const { matchingPeople, matchingTeams } = useMemo(() => {
    const q = query.trim().toLowerCase();
    return {
      matchingPeople: q
        ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
        : people,
      matchingTeams: q
        ? teams.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
        : teams,
    };
  }, [people, teams, query]);

  // One flat order for the keyboard: people, then teams, as rendered.
  const options = useMemo<readonly GranteeCandidate[]>(
    () => [...matchingPeople, ...matchingTeams],
    [matchingPeople, matchingTeams],
  );

  const commitSelection = useCallback(
    (candidate: GranteeCandidate) => {
      if (isExcluded(candidate)) return;
      onChange(candidate);
      setQuery("");
      setOpen(false);
    },
    [isExcluded, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const choice = options[activeIndex];
        if (choice) commitSelection(choice);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [options, activeIndex, commitSelection],
  );

  const fieldLabel = includeTeams ? "Person or team" : "Person";

  if (value) {
    return (
      <div className={cn("stg:space-y-1", className)}>
        <span className="stg:block stg:text-xs stg:font-medium stg:text-foreground">{fieldLabel}</span>
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5">
          <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
            <GranteeAvatar kind={value.kind} name={value.name} />
            <div className="stg:min-w-0">
              <div className="stg:flex stg:items-center stg:gap-1.5">
                <span className="stg:truncate stg:text-xs stg:text-foreground">{value.name}</span>
                {value.kind === "identity_account" && <ProviderBadge principal={value.view} />}
              </div>
              <SelectedSubline value={value} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label={value.kind === "team" ? "Clear selected team" : "Clear selected person"}
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

  const renderOption = (candidate: GranteeCandidate, index: number) => {
    const excludedNow = isExcluded(candidate);
    const isActive = index === activeIndex;
    return (
      <li
        key={granteeKey(candidate.grantee)}
        role="option"
        aria-selected={isActive}
        aria-disabled={excludedNow}
        onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={(e) => {
          // Prevent input blur before selection commits.
          e.preventDefault();
          commitSelection(candidate);
        }}
        className={cn(
          "stg:flex stg:items-center stg:justify-between stg:gap-2 stg:px-2.5 stg:py-1.5",
          excludedNow ? "stg:cursor-not-allowed stg:opacity-50" : "stg:cursor-pointer",
          isActive && !excludedNow && "stg:bg-accent-hover",
        )}
      >
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          <GranteeAvatar kind={candidate.kind} name={candidate.name} />
          <div className="stg:min-w-0">
            <div className="stg:flex stg:items-center stg:gap-1.5">
              <span className="stg:truncate stg:text-xs stg:text-foreground">{candidate.name}</span>
              {candidate.kind === "identity_account" && showProviderBadge(candidate, duplicatedEmails) && (
                <ProviderBadge principal={candidate.view} />
              )}
            </div>
            <CandidateSubline candidate={candidate} />
          </div>
        </div>
        {excludedNow && (
          <span className="stg:shrink-0 stg:text-[0.6rem] stg:text-muted-foreground">Has access</span>
        )}
      </li>
    );
  };

  const nothingMatches = options.length === 0;

  return (
    <div className={cn("stg:space-y-1", className)}>
      <label
        htmlFor={`${listboxId}-input`}
        className="stg:block stg:text-xs stg:font-medium stg:text-foreground"
      >
        {fieldLabel}
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
          placeholder={includeTeams ? "Search people or teams" : "Search by name or email"}
          disabled={disabled || isLoading}
          autoFocus={autoFocus}
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
            aria-label={includeTeams ? "People and teams" : "Organization members"}
            className={cn(
              UNSTYLED_LIST,
              "stg:absolute stg:z-10 stg:mt-1 stg:max-h-56 stg:w-full stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-popover stg:py-1 stg:shadow-md",
            )}
          >
            {isLoading && (
              <li className="stg:px-2.5 stg:py-2 stg:text-xs stg:text-muted-foreground">
                {includeTeams ? "Loading people and teams…" : "Loading members…"}
              </li>
            )}

            {!isLoading && error && (
              <li className="stg:px-2.5 stg:py-2 stg:text-[0.65rem] stg:text-destructive" role="alert">
                {getUserMessage(error)}
              </li>
            )}

            {!isLoading && !error && nothingMatches && (
              <li className="stg:px-2.5 stg:py-2 stg:text-xs stg:text-muted-foreground">
                {query.trim() ? "No one matches your search." : "No one to share with."}
              </li>
            )}

            {!isLoading && !error && !nothingMatches && !includeTeams &&
              matchingPeople.map((person, index) => renderOption(person, index))}

            {!isLoading && !error && !nothingMatches && includeTeams && (
              <>
                <OptionGroup label="People" count={matchingPeople.length}>
                  {matchingPeople.map((person, index) => renderOption(person, index))}
                </OptionGroup>
                <OptionGroup label="Teams" count={matchingTeams.length}>
                  {matchingTeams.map((team, index) => renderOption(team, matchingPeople.length + index))}
                </OptionGroup>
              </>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

/** Show the provider badge when it disambiguates: an external identity source, or a shared email. */
function showProviderBadge(person: PersonCandidate, duplicatedEmails: ReadonlySet<string>): boolean {
  return (
    !!providerLabel(person.view) &&
    (person.view.identityOrigin?.providerDisplayName !== "Stigmer" ||
      (!!person.email && duplicatedEmails.has(person.email.toLowerCase())))
  );
}

function OptionGroup({
  label,
  count,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  const headingId = useId();
  if (count === 0) return null;
  return (
    <li role="presentation">
      <div
        id={headingId}
        className="stg:px-2.5 stg:pt-1.5 stg:pb-1 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground"
      >
        {label}
      </div>
      <ul role="group" aria-labelledby={headingId} className={UNSTYLED_LIST}>
        {children}
      </ul>
    </li>
  );
}

function CandidateSubline({ candidate }: { readonly candidate: GranteeCandidate }) {
  const text =
    candidate.kind === "team"
      ? candidate.description
      : candidate.email !== candidate.name
        ? candidate.email
        : "";
  if (!text) return null;
  return (
    <span className="stg:block stg:truncate stg:text-[0.6rem] stg:text-muted-foreground">{text}</span>
  );
}

function SelectedSubline({ value }: { readonly value: SelectedGrantee }) {
  if (value.kind === "team") {
    return <span className="stg:block stg:truncate stg:text-[0.6rem] stg:text-muted-foreground">Team</span>;
  }
  return <CandidateSubline candidate={value} />;
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
