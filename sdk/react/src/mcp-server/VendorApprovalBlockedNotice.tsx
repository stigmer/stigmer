"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link VendorApprovalBlockedNotice}. */
export interface VendorApprovalBlockedNoticeProps {
  /**
   * `true` when the platform OAuth app's vendor approval is PENDING or
   * REJECTED — the platform-managed sign-in flow is blocked. The notice
   * renders `null` when `false`.
   */
  readonly blocked: boolean;
  /**
   * `true` when the approval is PENDING (awaiting review), `false` when
   * REJECTED. Only consulted while `blocked` — it picks the honest status
   * sentence, since "awaiting approval" is a lie for a rejected app.
   */
  readonly pending: boolean;
  /**
   * Whether a manually-entered static token can authenticate this server
   * (`false` for `oauth_only` servers). Gates the "enter a token manually"
   * mention — recommending it on an `oauth_only` server sends the user
   * down a path that cannot succeed (stigmer/stigmer#412).
   */
  readonly manualEntrySupported: boolean;
  /**
   * Whether the BYOA path is relevant for this server (vendor OAuth with
   * no org override active). Gates the "use your own OAuth app" mention.
   */
  readonly canBringOwnApp: boolean;
  /**
   * Documentation URL for bringing your own OAuth credentials, or `null`.
   * Linked when BYOA is not offered inline — when it is, the BYOA form
   * itself carries the link, and doubling it here would only add noise.
   */
  readonly docsUrl: string | null;
  /**
   * Renders the "Use your own OAuth app" call-to-action when provided
   * together with `canBringOwnApp`. Surfaces that host the BYOA form
   * open it in place; the connect dialog navigates to the detail page
   * where the form lives.
   */
  readonly onBringOwnApp?: () => void;
  /**
   * Dense rendering for tight surfaces (the session-setup config panel):
   * smaller type, no icon, no tinted container.
   */
  readonly compact?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Explains why the platform-managed OAuth sign-in is blocked by vendor
 * approval and — critically — what the user can do instead.
 *
 * This is the single source of truth for the blocked-state message: the
 * connect dialog, the server detail page, and the session-setup config
 * panel all render this component instead of hand-rolling the copy.
 * Before extraction each surface drifted independently — the dialog could
 * show a disabled button with no explanation at all, and two surfaces
 * recommended manual token entry on servers whose endpoint rejects static
 * tokens (stigmer/stigmer#412).
 *
 * The alternative-path sentence is derived from what is actually
 * available, never asserted: manual entry only when the endpoint accepts
 * static tokens, BYOA only when the server uses vendor OAuth without an
 * org override. When nothing is available the notice still explains the
 * state — a disabled control must never be the only signal (Nielsen:
 * visibility of system status).
 *
 * Self-gating: renders `null` unless `blocked`. Callers keep their own
 * situational gates (connected state, org-override state) and render this
 * unconditionally inside them, mirroring {@link OAuthRequiredNotice}.
 *
 * All visual properties flow through `--stgm-*` design tokens except the
 * amber warning palette, which matches the pre-existing vendor-approval
 * treatment across the MCP surfaces. No Console-specific dependencies —
 * safe for platform-builder embedding.
 */
export function VendorApprovalBlockedNotice({
  blocked,
  pending,
  manualEntrySupported,
  canBringOwnApp,
  docsUrl,
  onBringOwnApp,
  compact,
  className,
}: VendorApprovalBlockedNoticeProps) {
  if (!blocked) return null;

  const statusSentence = pending
    ? "The platform's OAuth app is awaiting vendor approval."
    : "The platform's OAuth app was not approved by the vendor.";

  const alternativeSentence = canBringOwnApp
    ? manualEntrySupported
      ? "You can use your own OAuth app or enter a token manually."
      : "You can use your own OAuth app."
    : manualEntrySupported
      ? "You can still connect by entering your own token manually."
      : "OAuth sign-in is temporarily unavailable for this server.";

  const showBringOwnApp = canBringOwnApp && onBringOwnApp;
  // When BYOA is offered inline the form carries the docs link itself.
  const showDocsLink = Boolean(docsUrl) && !canBringOwnApp;

  if (compact) {
    return (
      <div
        className={cn(
          "stg:text-[0.65rem] stg:text-amber-700 stg:dark:text-amber-300",
          className,
        )}
      >
        <p>
          {statusSentence} {alternativeSentence}
        </p>
        {showBringOwnApp && (
          <button
            type="button"
            onClick={onBringOwnApp}
            className="stg:mt-1 stg:inline-flex stg:items-center stg:gap-1 stg:rounded stg:bg-amber-600 stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:text-white stg:hover:bg-amber-700 stg:dark:bg-amber-500 stg:dark:text-amber-950 stg:dark:hover:bg-amber-400"
          >
            Use your own OAuth app
          </button>
        )}
        {showDocsLink && (
          <a
            href={docsUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="stg:underline stg:decoration-amber-600/40 stg:underline-offset-2 stg:hover:decoration-amber-600 stg:dark:decoration-amber-400/40 stg:dark:hover:decoration-amber-400"
          >
            Learn how to bring your own token
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "stg:flex stg:items-start stg:gap-2 stg:bg-amber-500/5 stg:px-3 stg:py-2",
        className,
      )}
    >
      <WarningIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-amber-600 stg:dark:text-amber-400" />
      <div className="stg:flex-1 stg:text-xs stg:text-amber-700 stg:dark:text-amber-300">
        <p>
          {statusSentence} {alternativeSentence}
        </p>
        {showBringOwnApp && (
          <button
            type="button"
            onClick={onBringOwnApp}
            data-cursor-target="byoa-cta-button"
            className="stg:mt-1.5 stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:bg-amber-600 stg:px-2.5 stg:py-1 stg:text-[11px] stg:font-medium stg:text-white stg:hover:bg-amber-700 stg:dark:bg-amber-500 stg:dark:text-amber-950 stg:dark:hover:bg-amber-400"
          >
            Use your own OAuth app
          </button>
        )}
        {showDocsLink && (
          <a
            href={docsUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="stg:mt-1 stg:inline-flex stg:items-center stg:gap-1 stg:underline stg:decoration-amber-600/40 stg:underline-offset-2 stg:hover:decoration-amber-600 stg:dark:decoration-amber-400/40 stg:dark:hover:decoration-amber-400"
          >
            Learn how to bring your own token
            <ExternalLinkIcon className="stg:size-3 stg:shrink-0" />
          </a>
        )}
      </div>
    </div>
  );
}

// Icon paths are verbatim copies of McpServerDetailView's private icons so
// the extracted banner renders pixel-identically to the one it replaces
// (the byoa-setup docs tour snapshots the blocked state).
function WarningIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 1 14h14L8 1.5Z" />
      <path d="M8 6v3.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8.667v4A1.333 1.333 0 0 1 10.667 14H3.333A1.333 1.333 0 0 1 2 12.667V5.333A1.333 1.333 0 0 1 3.333 4h4" />
      <path d="M10 2h4v4" />
      <path d="M6.667 9.333 14 2" />
    </svg>
  );
}
