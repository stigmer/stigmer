/**
 * Stigmer brand logo for public pages (login, invite).
 *
 * Console-only — platform builders embedding SDK components provide
 * their own branding. This component must NOT be moved to
 * `@stigmer/react`.
 */
export function StigmerLogo() {
  return (
    <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary-foreground"
        aria-hidden="true"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}
