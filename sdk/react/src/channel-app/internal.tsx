"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";

/**
 * Internal building blocks shared by the channel-app forms and panels.
 * Not exported from the package — content-level pieces stay domain-local.
 */

/** Labeled text/password input with an optional hint line. */
export function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  type?: "text" | "password";
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn(
          "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />
      {hint && <p className="text-[0.65rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A single-line copyable value (webhook URL, redirect URL) with a copy
 * button that confirms briefly.
 */
export function CopyRow({
  label,
  value,
  copyTargetId,
}: {
  label: string;
  value: string;
  copyTargetId?: string;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <code
          className={cn(
            "min-w-0 flex-1 truncate rounded-md border border-border bg-muted-subtle",
            "px-2 py-1.5 font-mono text-[0.65rem] text-foreground",
          )}
          title={value}
        >
          {value}
        </code>
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
    </div>
  );
}

/** A multi-line copyable value (the app manifest) in a scrollable block. */
export function CopyBlock({
  label,
  value,
  copyTargetId,
}: {
  label: string;
  value: string;
  copyTargetId?: string;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[0.65rem] font-medium text-muted-foreground">
          {label}
        </p>
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto rounded-md border border-border bg-muted-subtle",
          "px-2.5 py-2 font-mono text-[0.65rem] leading-relaxed text-foreground",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

function CopyButton({
  copied,
  onCopy,
  copyTargetId,
}: {
  copied: boolean;
  onCopy: () => void;
  copyTargetId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      data-cursor-target={copyTargetId}
      className={cn(
        "shrink-0 rounded-md border border-border px-2 py-1 text-[0.65rem] font-medium transition-colors",
        copied
          ? "text-success"
          : "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
      )}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return { copied, copy };
}

export function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
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
