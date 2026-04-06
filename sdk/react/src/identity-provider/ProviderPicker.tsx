"use client";

import { cn } from "@stigmer/theme";
import { PROVIDER_PRESETS, type ProviderPreset } from "./presets";

/** Props for {@link ProviderPicker}. */
export interface ProviderPickerProps {
  /** Fired when the user selects a provider preset. */
  readonly onSelect: (preset: ProviderPreset) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Grid of well-known identity provider cards for the first step of
 * the creation wizard.
 *
 * Each card shows an icon, provider name, and short description.
 * Clicking a card fires {@link ProviderPickerProps.onSelect} with
 * the corresponding {@link ProviderPreset}.
 *
 * The "Custom OIDC" card is visually distinct (dashed border) to
 * signal that it triggers a different flow (OIDC Discovery).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ProviderPicker onSelect={(preset) => setSelectedPreset(preset)} />
 * ```
 */
export function ProviderPicker({ onSelect, className }: ProviderPickerProps) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}
      role="listbox"
      aria-label="Choose an identity provider"
    >
      {PROVIDER_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onSelect(preset)}
          className={cn(
            "flex flex-col items-start gap-2 rounded-lg px-3 py-3 text-left transition-colors",
            "border hover:border-primary/60 hover:bg-accent/30",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            preset.id === "custom"
              ? "border-dashed border-border"
              : "border-border/60",
          )}
        >
          <ProviderIcon presetId={preset.id} />
          <div className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {preset.label}
            </span>
            <span className="block text-[0.65rem] leading-tight text-muted-foreground">
              {preset.description}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider icons — simple thematic SVGs, one per preset
// ---------------------------------------------------------------------------

function ProviderIcon({ presetId }: { presetId: string }) {
  const Icon = ICON_MAP[presetId] ?? DefaultIcon;
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
      <Icon />
    </span>
  );
}

const ICON_MAP: Record<string, React.ComponentType> = {
  auth0: LockIcon,
  okta: KeyIcon,
  google: GlobeIcon,
  "azure-ad": CloudIcon,
  "aws-cognito": UsersIcon,
  custom: CodeIcon,
};

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <circle cx="5.5" cy="10" r="3" />
      <path d="M8 8l5.5-5.5M11 5l2-0.5L13.5 2.5" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2.5 4 2.5 6S10 14 8 14c-2-2-2.5-4-2.5-6S6 2 8 2z" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <path d="M4 12.5h8.5a3 3 0 0 0 0-6 .5.5 0 0 1-.5-.4A4.5 4.5 0 0 0 3.5 8v.5a3 3 0 0 0 .5 6z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 14c0-2.5 2-4.5 4.5-4.5S10.5 11.5 10.5 14" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M14.5 14c0-1.5-1-3-2.5-3.5" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <path d="M5 4.5L1.5 8 5 11.5M11 4.5l3.5 3.5-3.5 3.5M9 2.5l-2 11" />
    </svg>
  );
}

function DefaultIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-foreground">
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}
