export function ChipSpinner() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="shrink-0 animate-spin text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

export function AlertTriangleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 1.5 13.5h13L8 1.5z" />
      <path d="M8 6v3" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12V4M4 7l4-4 4 4" />
    </svg>
  );
}

export function SpinnerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

/**
 * Filled rounded square — the universal "stop" glyph. Sized to ~62% of the
 * viewBox so it reads as a confident, deliberate mark (not a stray dot) when
 * centered inside the circular Stop button. Pairs with ChatGPT/Claude-style
 * circle-and-square stop affordances.
 */
export function StopIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="10" height="10" rx="2.5" />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

export function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 7L7 12.5a3.536 3.536 0 0 1-5-5L7.5 2a2.357 2.357 0 0 1 3.333 3.333L5.5 10.667a1.179 1.179 0 0 1-1.667-1.667L9 3.833" />
    </svg>
  );
}

export function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="10" height="8" rx="2" />
      <circle cx="6" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M8 1v4" />
      <circle cx="8" cy="1" r="1" />
    </svg>
  );
}

export function WorkspaceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

export function McpServerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <circle cx="5" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SkillIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3h12M2 7h8M2 11h10M2 15h6" />
    </svg>
  );
}

export function SecretsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="10" height="6" rx="1.5" />
      <path d="M5 8V5.5a3 3 0 0 1 6 0V8" />
      <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Horizontal sliders icon -- signals "configuration" without conflating with "add content." */
export function ConfigureIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4h4m4 0h4M2 8h8m4 0h0M2 12h2m4 0h6" />
      <circle cx="8" cy="4" r="2" />
      <circle cx="12" cy="8" r="2" />
      <circle cx="6" cy="12" r="2" />
    </svg>
  );
}

export function ResolveSpinner() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="animate-spin text-muted-foreground"
        aria-hidden="true"
      >
        <path d="M8 2a6 6 0 1 0 6 6" />
      </svg>
      <span className="text-[0.6rem] text-muted-foreground">
        Checking agent requirements...
      </span>
    </div>
  );
}
