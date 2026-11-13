"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/design-tokens";
import { SCROLL_REGION_FOCUS, scrollRegion } from "./scroll-region.js";
import { useCopyFeedback } from "./useCopyFeedback.js";

/**
 * Copyable values shared across domains: a multi-line block (a channel
 * app's manifest, a routine's curl) and the copy button single-line rows
 * pair with. Internal: not exported from the package.
 */

/**
 * A multi-line copyable value (an app manifest, a command) in a scrollable
 * block, which the keyboard reaches as a region named by `label`. `tall`
 * gives a whole source file room to be read in place.
 */
export function CopyBlock({
  label,
  value,
  copyTargetId,
  tall = false,
}: {
  label: string;
  value: string;
  copyTargetId?: string;
  tall?: boolean;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="stg:space-y-1">
      <div className="stg:flex stg:items-center stg:justify-between">
        <p className="stg:text-2xs stg:font-medium stg:text-muted-foreground">
          {label}
        </p>
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
      <pre
        {...scrollRegion(label)}
        className={cn(
          tall ? "stg:max-h-96" : "stg:max-h-40",
          "stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle",
          "stg:px-2.5 stg:py-2 stg:font-mono stg:text-2xs stg:leading-relaxed stg:text-foreground",
          SCROLL_REGION_FOCUS,
        )}
      >
        {value}
      </pre>
    </div>
  );
}

/** The copy button beside a copyable value; says "Copied" briefly. */
export function CopyButton({
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
        "stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:px-2 stg:py-1 stg:text-2xs stg:font-medium stg:transition-colors",
        copied
          ? "stg:text-status-ready"
          : "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
      )}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Copies one held value and flashes the `copied` flag. */
export function useCopy(value: string) {
  const { copy: copyText, copied } = useCopyFeedback();

  const copy = useCallback(() => {
    void copyText(value);
  }, [copyText, value]);

  return { copied, copy };
}
