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
    <div className="stg:space-y-1">
      <label htmlFor={id} className="stg:text-xs stg:font-medium stg:text-foreground">
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
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:placeholder:text-muted-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      />
      {hint && <p className="stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>}
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
    <div className="stg:space-y-1">
      <p className="stg:text-xs stg:font-medium stg:text-foreground">{label}</p>
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <code
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:truncate stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle",
            "stg:px-2 stg:py-1.5 stg:font-mono stg:text-[0.65rem] stg:text-foreground",
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
    <div className="stg:space-y-1">
      <div className="stg:flex stg:items-center stg:justify-between">
        <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
          {label}
        </p>
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
      <pre
        className={cn(
          "stg:max-h-40 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle",
          "stg:px-2.5 stg:py-2 stg:font-mono stg:text-[0.65rem] stg:leading-relaxed stg:text-foreground",
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
        "stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:px-2 stg:py-1 stg:text-[0.65rem] stg:font-medium stg:transition-colors",
        copied
          ? "stg:text-success"
          : "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
